import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { TestApp, closeTestApp, createTestApp } from '../../test/app';
import { FakeTemporalService } from '../../test/fakes';
import { ShoppingAgent } from '../temporal/shopping-agent-workflow';

const request = 'Buy me a kettle and two sets of mugs. Keep it under £100.';
const buyer = { email: 'ada@example.com', name: 'Ada Lovelace' };

const proposal = {
  lines: [
    {
      productId: 'sku_kettle',
      title: 'Stainless Steel Kettle',
      quantity: 1,
      unitPrice: 3499,
      total: 3499,
    },
    {
      productId: 'sku_mug_set',
      title: 'Stoneware Mug Set (4 pack)',
      quantity: 2,
      unitPrice: 2400,
      total: 4800,
    },
  ],
  currency: 'GBP',
  total: 8299,
  budget: 10000,
};

describe('ShoppingAgentController', () => {
  let app: NestFastifyApplication;
  let temporal: FakeTemporalService;
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app, temporal } = testApp);
  });

  afterEach(() => closeTestApp(testApp));

  function start(payload: object) {
    return app.inject({ method: 'POST', url: '/v1/demo/shopping-agents', payload });
  }

  function get(id: string) {
    return app.inject({ method: 'GET', url: `/v1/demo/shopping-agents/${id}` });
  }

  function decide(id: string, payload: object) {
    return app.inject({ method: 'POST', url: `/v1/demo/shopping-agents/${id}/decision`, payload });
  }

  async function startAgent(payload: object = { request, buyer }): Promise<string> {
    const res = await start(payload);
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  // Stands in for the Go Workflow finishing planning
  function proposed(id: string) {
    const agent = temporal.agents.get(id) as ShoppingAgent;
    agent.status = 'awaiting_approval';
    agent.proposal = structuredClone(proposal);
  }

  describe('POST /v1/demo/shopping-agents', () => {
    it('starts a Shopping Agent Workflow and returns its ID', async () => {
      const res = await start({ request, buyer });

      expect(res.statusCode).toBe(201);
      const { id } = res.json();
      expect(id).toMatch(/^agent_[0-9a-f-]{36}$/);
      expect(temporal.startShoppingAgentWorkflow).toHaveBeenCalledExactlyOnceWith(id, {
        request,
        buyer,
        demo: { scenario: 'none' },
      });
    });

    it('passes the inventory failure configuration separately from the request', async () => {
      const id = await startAgent({ request, buyer, demo: { inventoryFailures: 2 } });

      expect(temporal.startShoppingAgentWorkflow).toHaveBeenCalledExactlyOnceWith(id, {
        request,
        buyer,
        demo: { scenario: 'none', inventoryFailures: 2 },
      });
    });

    it('starts a separate Workflow for each request', async () => {
      const first = await startAgent();
      const second = await startAgent();

      expect(second).not.toBe(first);
      expect(temporal.agents.size).toBe(2);
    });

    it('does not pass unknown fields to the Workflow', async () => {
      const id = await startAgent({ request, buyer: { ...buyer, id: 'admin' }, budget: 1 });

      expect(temporal.startShoppingAgentWorkflow).toHaveBeenCalledExactlyOnceWith(id, {
        request,
        buyer,
        demo: { scenario: 'none' },
      });
    });

    it.each([
      ['none', 'none'],
      ['ai_service_unavailable', 'ai_service_unavailable'],
    ] as const)('accepts the %s scenario and passes it to the Workflow', async (_, scenario) => {
      const id = await startAgent({ request, buyer, demo: { scenario } });

      expect(temporal.startShoppingAgentWorkflow).toHaveBeenCalledExactlyOnceWith(id, {
        request,
        buyer,
        demo: { scenario },
      });
    });

    it('keeps the scenario and inventory failures independent', async () => {
      const id = await startAgent({
        request,
        buyer,
        demo: { scenario: 'ai_service_unavailable', inventoryFailures: 2 },
      });

      expect(temporal.startShoppingAgentWorkflow).toHaveBeenCalledExactlyOnceWith(id, {
        request,
        buyer,
        demo: { scenario: 'ai_service_unavailable', inventoryFailures: 2 },
      });
    });

    it('shows the scenario in the agent state', async () => {
      const id = await startAgent({ request, buyer, demo: { scenario: 'ai_service_unavailable' } });

      expect((await get(id)).json()).toMatchObject({
        status: 'planning',
        demo: { scenario: 'ai_service_unavailable' },
      });
    });

    it.each([
      ['a missing request', { buyer }],
      ['a blank request', { request: '   ', buyer }],
      ['an overlong request', { request: 'a'.repeat(1001), buyer }],
      ['a missing buyer', { request }],
      ['an invalid email', { request, buyer: { email: 'not-an-email' } }],
      ['negative inventory failures', { request, buyer, demo: { inventoryFailures: -1 } }],
      ['too many inventory failures', { request, buyer, demo: { inventoryFailures: 3 } }],
      ['fractional inventory failures', { request, buyer, demo: { inventoryFailures: 1.5 } }],
      ['an unknown scenario', { request, buyer, demo: { scenario: 'payment_declined' } }],
      [
        'a differently cased scenario',
        { request, buyer, demo: { scenario: 'AI_SERVICE_UNAVAILABLE' } },
      ],
      ['a numeric scenario', { request, buyer, demo: { scenario: 5 } }],
    ])('rejects %s', async (_, payload) => {
      const res = await start(payload);

      expect(res.statusCode).toBe(400);
      expect(temporal.startShoppingAgentWorkflow).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.startShoppingAgentWorkflow.mockRejectedValueOnce(new Error('Temporal unavailable'));

      expect((await start({ request, buyer })).statusCode).toBe(500);
    });
  });

  describe('GET /v1/demo/shopping-agents/:id', () => {
    it('returns the state of a running Workflow', async () => {
      const id = await startAgent();

      const planning = await get(id);
      expect(planning.statusCode).toBe(200);
      expect(planning.json()).toEqual({
        id,
        status: 'planning',
        request,
        buyer,
        demo: { scenario: 'none' },
        createdAt: expect.any(String),
      });

      proposed(id);
      expect((await get(id)).json()).toMatchObject({ status: 'awaiting_approval', proposal });
    });

    it('returns the final state of a completed purchase', async () => {
      const id = await startAgent();
      temporal.agents.set(id, {
        ...(temporal.agents.get(id) as ShoppingAgent),
        status: 'purchased',
        proposal,
        decision: { decision: 'approve', decidedAt: '2026-11-08T12:00:00Z' },
        checkoutId: 'chk_123',
        orderId: 'ord_123',
        orderPermalinkUrl: 'http://localhost:9999/orders/ord_123',
      });

      const res = await get(id);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id,
        request,
        status: 'purchased',
        proposal,
        decision: { decision: 'approve' },
        checkoutId: 'chk_123',
        orderId: 'ord_123',
      });
    });

    it('returns a Workflow that ended without state as failed', async () => {
      temporal.agents.set('agent_terminated', {
        id: 'agent_terminated',
        status: 'failed',
        error: 'Terminated by operator',
      });

      const res = await get('agent_terminated');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: 'agent_terminated',
        status: 'failed',
        error: 'Terminated by operator',
      });
    });

    it('returns 404 for an unknown Workflow', async () => {
      const res = await get('agent_missing');

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ message: 'Shopping agent "agent_missing" was not found' });
    });

    it('returns 404 without calling Temporal for IDs not issued by the API', async () => {
      const res = await get('ord_123');

      expect(res.statusCode).toBe(404);
      expect(temporal.getShoppingAgent).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.getShoppingAgent.mockRejectedValueOnce(new Error('Temporal unavailable'));

      expect((await get('agent_123')).statusCode).toBe(500);
    });
  });

  describe('POST /v1/demo/shopping-agents/:id/decision', () => {
    it('approves the proposal and returns the state', async () => {
      const id = await startAgent();
      proposed(id);

      const res = await decide(id, {
        decision: 'approve',
        decidedBy: 'ada@example.com',
        note: 'Looks good',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id,
        status: 'approved',
        proposal,
        decision: { decision: 'approve', decidedBy: 'ada@example.com', note: 'Looks good' },
      });
    });

    it('sends exactly the Go Update payload', async () => {
      const id = await startAgent();
      proposed(id);

      await decide(id, { decision: 'reject', decidedBy: 'ada@example.com', extra: 'ignored' });

      expect(temporal.decidePurchase).toHaveBeenCalledExactlyOnceWith(id, {
        decision: 'reject',
        decidedBy: 'ada@example.com',
        note: undefined,
      });
    });

    it('rejects the proposal and returns the final state', async () => {
      const id = await startAgent();
      proposed(id);

      const res = await decide(id, { decision: 'reject', note: 'Too expensive' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'rejected', decision: { decision: 'reject' } });
      expect(res.json()).not.toHaveProperty('checkoutId');
    });

    it.each([
      ['a missing decision', {}],
      ['an unknown decision', { decision: 'maybe' }],
      ['a differently cased decision', { decision: 'APPROVE' }],
      ['an overlong note', { decision: 'approve', note: 'n'.repeat(501) }],
    ])('rejects %s with HTTP 400', async (_, payload) => {
      const id = await startAgent();
      proposed(id);

      const res = await decide(id, payload);

      expect(res.statusCode).toBe(400);
      expect(temporal.decidePurchase).not.toHaveBeenCalled();
    });

    it('returns 409 with the Workflow reason while planning', async () => {
      const id = await startAgent();

      const res = await decide(id, { decision: 'approve' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        message: 'shopping agent is not awaiting approval: status is planning',
      });
    });

    it('returns 409 for a second decision and keeps the first', async () => {
      const id = await startAgent();
      proposed(id);
      await decide(id, { decision: 'approve' });

      const res = await decide(id, { decision: 'reject' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        message: 'shopping agent is not awaiting approval: status is approved',
      });
      expect((await get(id)).json()).toMatchObject({ decision: { decision: 'approve' } });
    });

    it('returns 409 once the Workflow has finished', async () => {
      const id = await startAgent();
      proposed(id);
      await decide(id, { decision: 'reject' });

      const res = await decide(id, { decision: 'approve' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        message: 'shopping agent has finished and cannot accept a decision',
      });
    });

    it('returns 404 for an unknown Workflow', async () => {
      expect((await decide('agent_missing', { decision: 'approve' })).statusCode).toBe(404);
    });

    it('returns 404 without calling Temporal for IDs not issued by the API', async () => {
      const res = await decide('ord_123', { decision: 'approve' });

      expect(res.statusCode).toBe(404);
      expect(temporal.decidePurchase).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.decidePurchase.mockRejectedValueOnce(new Error('Temporal unavailable'));

      expect((await decide('agent_123', { decision: 'approve' })).statusCode).toBe(500);
    });
  });
});
