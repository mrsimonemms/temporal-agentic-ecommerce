import { Test } from '@nestjs/testing';
import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client';

import { OrderInput } from './order-workflow';
import { CONNECTION, WORKFLOW_CLIENT } from './temporal.providers';
import { TemporalService } from './temporal.service';

const input: OrderInput = {
  id: 'ord_123',
  buyer: { email: 'jane@example.com' },
  currency: 'GBP',
  lines: [{ id: 'li_1', productId: 'sku_kettle', quantity: 1, unitPrice: 3499 }],
};

describe('TemporalService', () => {
  let service: TemporalService;
  let start: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let signal: ReturnType<typeof vi.fn>;
  let getHandle: ReturnType<typeof vi.fn>;
  let withDeadline: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    start = vi.fn().mockResolvedValue({});
    query = vi.fn();
    signal = vi.fn().mockResolvedValue(undefined);
    getHandle = vi.fn(() => ({ query, signal }));
    withDeadline = vi.fn((_deadline: number, fn: () => Promise<unknown>) => fn());

    const moduleRef = await Test.createTestingModule({
      providers: [
        TemporalService,
        { provide: CONNECTION, useValue: {} },
        {
          provide: WORKFLOW_CLIENT,
          useValue: { withDeadline, workflow: { start, getHandle } },
        },
      ],
    }).compile();

    service = moduleRef.get(TemporalService);
  });

  describe('startOrderWorkflow', () => {
    it('starts the Go OrderWorkflow idempotently using the Order ID', async () => {
      await service.startOrderWorkflow(input);

      expect(start).toHaveBeenCalledExactlyOnceWith('OrderWorkflow', {
        taskQueue: 'order-management',
        workflowId: 'ord_123',
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    });

    it('bounds the start request with a deadline', async () => {
      const before = Date.now();

      await service.startOrderWorkflow(input);

      expect(withDeadline).toHaveBeenCalledOnce();
      expect(withDeadline.mock.calls[0][0]).toBeGreaterThan(before);
    });

    it('treats an existing closed Workflow for the Order as already started', async () => {
      start.mockRejectedValueOnce(
        new WorkflowExecutionAlreadyStartedError('already started', 'ord_123', 'OrderWorkflow'),
      );

      await expect(service.startOrderWorkflow(input)).resolves.toBeUndefined();
    });

    it('propagates other failures', async () => {
      start.mockRejectedValueOnce(new Error('Temporal unavailable'));

      await expect(service.startOrderWorkflow(input)).rejects.toThrow('Temporal unavailable');
    });
  });

  describe('getOrder', () => {
    it('queries the Order Workflow using the getOrder Query', async () => {
      const order = { id: 'ord_123', status: 'confirmed' };
      query.mockResolvedValueOnce(order);

      await expect(service.getOrder('ord_123')).resolves.toEqual(order);
      expect(getHandle).toHaveBeenCalledExactlyOnceWith('ord_123');
      expect(query).toHaveBeenCalledExactlyOnceWith('getOrder');
      expect(withDeadline).toHaveBeenCalledOnce();
    });

    it('returns undefined when no Workflow exists', async () => {
      query.mockRejectedValueOnce(new WorkflowNotFoundError('not found', 'ord_123', undefined));

      await expect(service.getOrder('ord_123')).resolves.toBeUndefined();
    });

    it('propagates other failures', async () => {
      query.mockRejectedValueOnce(new Error('Temporal unavailable'));

      await expect(service.getOrder('ord_123')).rejects.toThrow('Temporal unavailable');
    });
  });

  describe('markOrderFulfilled', () => {
    it('sends the markFulfilled Signal with the Go MarkFulfilledSignal payload', async () => {
      await expect(service.markOrderFulfilled('ord_123')).resolves.toBe(true);
      expect(getHandle).toHaveBeenCalledExactlyOnceWith('ord_123');
      expect(signal).toHaveBeenCalledExactlyOnceWith('markFulfilled', {});
      expect(withDeadline).toHaveBeenCalledOnce();
    });

    it('returns false when no running Workflow exists', async () => {
      signal.mockRejectedValueOnce(new WorkflowNotFoundError('not found', 'ord_123', undefined));

      await expect(service.markOrderFulfilled('ord_123')).resolves.toBe(false);
    });

    it('propagates other failures', async () => {
      signal.mockRejectedValueOnce(new Error('Temporal unavailable'));

      await expect(service.markOrderFulfilled('ord_123')).rejects.toThrow('Temporal unavailable');
    });
  });
});
