import { Test } from '@nestjs/testing';
import {
  ApplicationFailure,
  TerminatedFailure,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
} from '@temporalio/client';

import { OrderInput, OrderUpdateRejectedError } from './order-workflow';
import {
  PurchaseDecisionRejectedError,
  ShoppingAgent,
  ShoppingAgentInput,
} from './shopping-agent-workflow';
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
  let executeUpdate: ReturnType<typeof vi.fn>;
  let describe_: ReturnType<typeof vi.fn>;
  let result: ReturnType<typeof vi.fn>;
  let getHandle: ReturnType<typeof vi.fn>;
  let withDeadline: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    start = vi.fn().mockResolvedValue({});
    query = vi.fn();
    signal = vi.fn().mockResolvedValue(undefined);
    executeUpdate = vi.fn();
    describe_ = vi.fn();
    result = vi.fn();
    getHandle = vi.fn(() => ({ query, signal, executeUpdate, describe: describe_, result }));
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

  describe('reportFulfilmentException', () => {
    const exception = { lineId: 'li_2', reason: 'Unavailable' };

    it('sends the reportFulfilmentException Signal with the Go payload', async () => {
      await expect(service.reportFulfilmentException('ord_123', exception)).resolves.toBe(true);
      expect(getHandle).toHaveBeenCalledExactlyOnceWith('ord_123');
      expect(signal).toHaveBeenCalledExactlyOnceWith('reportFulfilmentException', exception);
      expect(withDeadline).toHaveBeenCalledOnce();
    });

    it('returns false when no running Workflow exists', async () => {
      signal.mockRejectedValueOnce(new WorkflowNotFoundError('not found', 'ord_123', undefined));

      await expect(service.reportFulfilmentException('ord_123', exception)).resolves.toBe(false);
    });

    it('propagates other failures', async () => {
      signal.mockRejectedValueOnce(new Error('Temporal unavailable'));

      await expect(service.reportFulfilmentException('ord_123', exception)).rejects.toThrow(
        'Temporal unavailable',
      );
    });
  });

  describe('resolveFulfilmentException', () => {
    const req = { lineId: 'li_2', alternativeSource: 'warehouse-north', approvedBy: 'ops' };

    it('executes the resolveFulfilmentException Update with the Go payload', async () => {
      const order = { id: 'ord_123', status: 'confirmed' };
      executeUpdate.mockResolvedValueOnce(order);

      await expect(service.resolveFulfilmentException('ord_123', req)).resolves.toEqual(order);
      expect(getHandle).toHaveBeenCalledExactlyOnceWith('ord_123');
      expect(executeUpdate).toHaveBeenCalledExactlyOnceWith('resolveFulfilmentException', {
        args: [req],
      });
      expect(withDeadline).toHaveBeenCalledOnce();
    });

    it('returns undefined when no running Workflow exists', async () => {
      executeUpdate.mockRejectedValueOnce(
        new WorkflowNotFoundError('not found', 'ord_123', undefined),
      );

      await expect(service.resolveFulfilmentException('ord_123', req)).resolves.toBeUndefined();
    });

    it('translates a rejected Update into OrderUpdateRejectedError', async () => {
      executeUpdate.mockRejectedValueOnce(
        new WorkflowUpdateFailedError(
          'Workflow Update failed',
          ApplicationFailure.nonRetryable(
            'order is not awaiting intervention: status is confirmed',
            'InvalidFulfilmentResolution',
          ),
        ),
      );

      const err = await service.resolveFulfilmentException('ord_123', req).catch((e) => e);

      expect(err).toBeInstanceOf(OrderUpdateRejectedError);
      expect(err.message).toBe('order is not awaiting intervention: status is confirmed');
      expect(err.type).toBe('InvalidFulfilmentResolution');
    });

    it('propagates other failures', async () => {
      executeUpdate.mockRejectedValueOnce(new Error('Temporal unavailable'));

      await expect(service.resolveFulfilmentException('ord_123', req)).rejects.toThrow(
        'Temporal unavailable',
      );
    });
  });

  describe('Shopping Agent', () => {
    const agentId = 'agent_123';

    const agentInput: ShoppingAgentInput = {
      request: 'Buy me a kettle and two sets of mugs. Keep it under £100.',
      buyer: { email: 'ada@example.com', name: 'Ada Lovelace' },
      demo: { inventoryFailures: 2 },
    };

    const agent: ShoppingAgent = {
      id: agentId,
      status: 'purchased',
      request: agentInput.request,
      buyer: agentInput.buyer,
      checkoutId: 'chk_123',
      orderId: 'ord_123',
      createdAt: '2026-11-08T12:00:00Z',
    };

    function described(status: string, type = 'ShoppingAgentWorkflow') {
      describe_.mockResolvedValue({ type, status: { name: status } });
    }

    describe('startShoppingAgentWorkflow', () => {
      it('starts the Go ShoppingAgentWorkflow with a new Workflow ID', async () => {
        await service.startShoppingAgentWorkflow(agentId, agentInput);

        expect(start).toHaveBeenCalledExactlyOnceWith('ShoppingAgentWorkflow', {
          taskQueue: 'order-management',
          workflowId: agentId,
          args: [agentInput],
          workflowIdConflictPolicy: 'FAIL',
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
        });
        expect(withDeadline).toHaveBeenCalledOnce();
      });
    });

    describe('getShoppingAgent', () => {
      it('queries a running Workflow', async () => {
        described('RUNNING');
        query.mockResolvedValue({ ...agent, status: 'awaiting_approval' });

        await expect(service.getShoppingAgent(agentId)).resolves.toMatchObject({
          status: 'awaiting_approval',
        });
        expect(getHandle).toHaveBeenCalledWith(agentId);
        expect(query).toHaveBeenCalledExactlyOnceWith('getShoppingAgent');
        expect(result).not.toHaveBeenCalled();
      });

      it('returns the result of a completed Workflow without querying it', async () => {
        described('COMPLETED');
        result.mockResolvedValue(agent);

        await expect(service.getShoppingAgent(agentId)).resolves.toEqual(agent);
        expect(query).not.toHaveBeenCalled();
      });

      it('returns the state attached to the failure of a failed Workflow', async () => {
        described('FAILED');
        const failed = { ...agent, status: 'failed', error: 'checkout was not completed' };
        result.mockRejectedValue(
          new WorkflowFailedError(
            'Workflow execution failed',
            ApplicationFailure.create({
              message: 'unable to complete purchase',
              type: 'PurchaseFailed',
              nonRetryable: true,
              details: [failed],
            }),
            'NON_RETRYABLE_FAILURE',
          ),
        );

        await expect(service.getShoppingAgent(agentId)).resolves.toEqual(failed);
        expect(query).not.toHaveBeenCalled();
      });

      it('reports a Workflow that ended without state as failed', async () => {
        described('TERMINATED');
        result.mockRejectedValue(
          new WorkflowFailedError(
            'Workflow execution terminated',
            new TerminatedFailure('Terminated by operator'),
            'NON_RETRYABLE_FAILURE',
          ),
        );

        await expect(service.getShoppingAgent(agentId)).resolves.toEqual({
          id: agentId,
          status: 'failed',
          error: 'Terminated by operator',
        });
      });

      it('returns undefined when no Workflow exists', async () => {
        describe_.mockRejectedValue(new WorkflowNotFoundError('not found', agentId, undefined));

        await expect(service.getShoppingAgent(agentId)).resolves.toBeUndefined();
      });

      it('returns undefined for a Workflow of another type', async () => {
        described('RUNNING', 'OrderWorkflow');

        await expect(service.getShoppingAgent(agentId)).resolves.toBeUndefined();
        expect(query).not.toHaveBeenCalled();
      });

      it('propagates other failures', async () => {
        describe_.mockRejectedValue(new Error('Temporal unavailable'));

        await expect(service.getShoppingAgent(agentId)).rejects.toThrow('Temporal unavailable');
      });
    });

    describe('decidePurchase', () => {
      const approve = { decision: 'approve' as const, decidedBy: 'ada@example.com' };

      it('executes the decidePurchase Update with the Go payload', async () => {
        described('RUNNING');
        executeUpdate.mockResolvedValue({ ...agent, status: 'approved' });

        await expect(service.decidePurchase(agentId, approve)).resolves.toMatchObject({
          status: 'approved',
        });
        expect(executeUpdate).toHaveBeenCalledExactlyOnceWith('decidePurchase', {
          args: [approve],
        });
      });

      it('translates a rejected Update into PurchaseDecisionRejectedError', async () => {
        described('RUNNING');
        executeUpdate.mockRejectedValue(
          new WorkflowUpdateFailedError(
            'Workflow Update failed',
            ApplicationFailure.create({
              message: 'shopping agent is not awaiting approval: status is planning',
              type: 'InvalidPurchaseDecision',
              nonRetryable: true,
            }),
          ),
        );

        const err = await service.decidePurchase(agentId, approve).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(PurchaseDecisionRejectedError);
        expect(err).toMatchObject({
          message: 'shopping agent is not awaiting approval: status is planning',
          type: 'InvalidPurchaseDecision',
        });
      });

      it('rejects a decision for a Workflow that has finished without sending an Update', async () => {
        described('COMPLETED');

        await expect(service.decidePurchase(agentId, approve)).rejects.toBeInstanceOf(
          PurchaseDecisionRejectedError,
        );
        expect(executeUpdate).not.toHaveBeenCalled();
      });

      it('rejects a decision when the Workflow closes before the Update is delivered', async () => {
        described('RUNNING');
        executeUpdate.mockRejectedValue(new WorkflowNotFoundError('completed', agentId, undefined));

        await expect(service.decidePurchase(agentId, approve)).rejects.toBeInstanceOf(
          PurchaseDecisionRejectedError,
        );
      });

      it('returns undefined when no Shopping Agent Workflow exists', async () => {
        described('RUNNING', 'OrderWorkflow');

        await expect(service.decidePurchase(agentId, approve)).resolves.toBeUndefined();
        expect(executeUpdate).not.toHaveBeenCalled();
      });
    });
  });
});
