import { Test } from '@nestjs/testing';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

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
  let withDeadline: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    start = vi.fn().mockResolvedValue({});
    withDeadline = vi.fn((_deadline: number, fn: () => Promise<unknown>) => fn());

    const moduleRef = await Test.createTestingModule({
      providers: [
        TemporalService,
        { provide: CONNECTION, useValue: {} },
        { provide: WORKFLOW_CLIENT, useValue: { withDeadline, workflow: { start } } },
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
});
