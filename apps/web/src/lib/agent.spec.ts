import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decidePurchase,
  getShoppingAgent,
  isFinal,
  isNotFound,
  scenarioLabel,
  startAgentRequest,
  startShoppingAgent,
} from './agent';
import { startPolling } from './poll';
import { agentFixture } from './testing/fixtures';
import { ApiError } from './ucp';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(json(body, status));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startShoppingAgent', () => {
  it('starts a Shopping Agent with the request, buyer and inventory failures', async () => {
    const fetchMock = respond({ id: 'agent_123' }, 201);
    const body = {
      request: 'Buy me a kettle and two sets of mugs. Keep it under £100.',
      buyer: { email: 'jane@example.com', name: 'Jane Doe' },
      demo: { inventoryFailures: 2 },
    };

    await expect(startShoppingAgent(body)).resolves.toEqual({ id: 'agent_123' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/shopping-agents');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('reports validation errors returned by the API', async () => {
    respond(
      { statusCode: 400, message: ['buyer.email must be an email'], error: 'Bad Request' },
      400,
    );

    await expect(
      startShoppingAgent({ request: 'Buy a kettle', buyer: { email: 'not-an-email' } }),
    ).rejects.toMatchObject({ message: 'buyer.email must be an email', status: 400 });
  });

  it('reports when the commerce API is unavailable', async () => {
    respond({ code: 'api_unavailable', content: 'The commerce API could not be reached' }, 502);

    await expect(
      startShoppingAgent({ request: 'Buy a kettle', buyer: { email: 'jane@example.com' } }),
    ).rejects.toMatchObject({ message: 'The commerce API could not be reached', status: 502 });
  });
});

describe('getShoppingAgent', () => {
  it('reads the Shopping Agent state, encoding the ID', async () => {
    const fetchMock = respond(agentFixture());
    const signal = new AbortController().signal;

    await expect(getShoppingAgent('agent_1/x', signal)).resolves.toEqual(agentFixture());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/shopping-agents/agent_1%2Fx');
    expect(init.signal).toBe(signal);
  });
});

describe('decidePurchase', () => {
  it('sends the decision and returns the state when it was recorded', async () => {
    const fetchMock = respond(agentFixture('approved'));

    await expect(
      decidePurchase('agent_123', { decision: 'approve', decidedBy: 'jane@example.com' }),
    ).resolves.toMatchObject({ status: 'approved' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/shopping-agents/agent_123/decision');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ decision: 'approve', decidedBy: 'jane@example.com' });
  });

  it('reports a decision the Workflow rejected', async () => {
    respond(
      {
        statusCode: 409,
        message: 'shopping agent is not awaiting approval: status is approved',
        error: 'Conflict',
      },
      409,
    );

    await expect(decidePurchase('agent_123', { decision: 'reject' })).rejects.toMatchObject({
      message: 'shopping agent is not awaiting approval: status is approved',
      status: 409,
    });
  });
});

describe('isFinal', () => {
  it.each([
    ['planning', false],
    ['awaiting_approval', false],
    ['approved', false],
    ['purchasing', false],
    ['purchased', true],
    ['rejected', true],
    ['failed', true],
  ] as const)('treats %s as final: %s', (status, final) => {
    expect(isFinal(agentFixture(status))).toBe(final);
  });
});

describe('isNotFound', () => {
  it('recognises unknown resources from the demo and UCP endpoints', () => {
    expect(isNotFound(new ApiError('Shopping agent "agent_x" was not found', 404))).toBe(true);
    expect(
      isNotFound(
        new ApiError('Order "ord_x" was not found', 200, [
          { type: 'error', code: 'not_found', content: 'Order "ord_x" was not found' },
        ]),
      ),
    ).toBe(true);
  });

  it('treats other failures as transient', () => {
    expect(isNotFound(new ApiError('The commerce API did not respond in time', 504))).toBe(false);
    expect(isNotFound(new Error('boom'))).toBe(false);
  });
});

describe('polling a Shopping Agent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows the agent until it finishes, keeping the last state through failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(agentFixture('purchasing')))
      .mockResolvedValueOnce(json({ code: 'api_timeout', content: 'Timed out' }, 504))
      .mockResolvedValueOnce(json(agentFixture('purchased')));
    vi.stubGlobal('fetch', fetchMock);
    const states: string[] = [];
    const errors: string[] = [];

    const stop = startPolling((signal) => getShoppingAgent('agent_123', signal), {
      intervalMs: 1000,
      onSuccess: (state) => states.push(state.status),
      onError: (err) => errors.push((err as Error).message),
      isFinal,
      isPermanent: isNotFound,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(states).toEqual(['purchasing', 'purchased']);
    expect(errors).toEqual(['Timed out']);
    // Nothing changes after the agent finishes, so polling has stopped
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops for an unknown agent', async () => {
    const fetchMock = respond(
      { statusCode: 404, message: 'Shopping agent "agent_x" was not found', error: 'Not Found' },
      404,
    );
    const onError = vi.fn();

    const stop = startPolling((signal) => getShoppingAgent('agent_x', signal), {
      intervalMs: 1000,
      onSuccess: vi.fn(),
      onError,
      isFinal,
      isPermanent: isNotFound,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    stop();
  });
});

describe('startAgentRequest', () => {
  const form = {
    request: '  Buy me a kettle and two sets of mugs. Keep it under £100.  ',
    name: 'Jane Doe',
    email: 'jane@example.com',
    scenario: 'none' as const,
    inventoryFailures: 0,
  };

  it('always sends the scenario, defaulting to normal execution', () => {
    expect(startAgentRequest(form)).toEqual({
      request: 'Buy me a kettle and two sets of mugs. Keep it under £100.',
      buyer: { email: 'jane@example.com', name: 'Jane Doe' },
      demo: { scenario: 'none' },
    });
  });

  it('sends the AI scenario and inventory failures independently', () => {
    expect(startAgentRequest({ ...form, scenario: 'ai_service_unavailable' }).demo).toEqual({
      scenario: 'ai_service_unavailable',
    });
    expect(startAgentRequest({ ...form, inventoryFailures: 2 }).demo).toEqual({
      scenario: 'none',
      inventoryFailures: 2,
    });
    expect(
      startAgentRequest({ ...form, scenario: 'ai_service_unavailable', inventoryFailures: 1 }).demo,
    ).toEqual({ scenario: 'ai_service_unavailable', inventoryFailures: 1 });
  });

  it('omits an empty name', () => {
    expect(startAgentRequest({ ...form, name: '  ' }).buyer).toEqual({ email: 'jane@example.com' });
  });
});

describe('scenarioLabel', () => {
  it('names each scenario, treating a missing one as normal execution', () => {
    expect(scenarioLabel('none')).toBe('Normal execution');
    expect(scenarioLabel(undefined)).toBe('Normal execution');
    expect(scenarioLabel('ai_service_unavailable')).toBe('AI service unavailable');
    expect(scenarioLabel('something_new')).toBe('something_new');
  });
});
