import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { agentFixture } from '../testing/fixtures';
import { text } from '../testing/text';
import AgentPanel from './AgentPanel.svelte';

const ondecide = () => {};

function renderPanel(props: Partial<Parameters<typeof AgentPanel>[1]> = {}) {
  return render(AgentPanel, { props: { agentId: 'agent_123', ondecide, ...props } });
}

function buttons(body: string): string[] {
  return [...body.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(([, label]) => label.trim());
}

describe('AgentPanel', () => {
  it('shows a loading state with the agent ID until the state is retrieved', () => {
    const content = text(renderPanel().body);

    expect(content).toContain('Loading shopping agent');
    expect(content).toContain('agent_123');
  });

  it('shows a friendly message for an unknown agent', () => {
    const { body } = renderPanel({ notFound: true });

    expect(text(body)).toContain('Shopping agent not found');
    expect(body).toContain('href="/"');
  });

  it('explains a failure to load before any state is known', () => {
    const content = text(renderPanel({ error: 'The commerce API did not respond in time' }).body);

    expect(content).toContain('Unable to load the shopping agent');
    expect(content).toContain('The commerce API did not respond in time');
  });

  it('shows the request while planning, without a proposal or approval controls', () => {
    const { body } = renderPanel({ agent: agentFixture('planning') });
    const content = text(body);

    expect(content).toContain('Buy me a kettle and two sets of mugs. Keep it under £100.');
    expect(content).toContain('For Jane Doe · jane@example.com');
    expect(content).toContain('Planning');
    expect(content).not.toContain('Validated proposal');
    // Nothing can be approved before a validated proposal exists
    expect(buttons(body)).toEqual([]);
  });

  it('shows the validated proposal with prices, total and budget', () => {
    const content = text(renderPanel({ agent: agentFixture('awaiting_approval') }).body);

    expect(content).toContain('Awaiting your approval');
    expect(content).toContain('Stainless Steel Kettle');
    expect(content).toContain('Stoneware Mug Set (4 pack)');
    expect(content).toContain('£34.99');
    expect(content).toContain('£24.00');
    expect(content).toContain('£48.00');
    expect(content).toContain('£82.99');
    expect(content).toContain('Budget £100.00');
    expect(content).toContain('£17.01 to spare');
  });

  it('offers approval and rejection while awaiting approval', () => {
    const { body } = renderPanel({ agent: agentFixture('awaiting_approval') });

    expect(buttons(body)).toEqual(['Reject', 'Approve purchase']);
    expect(body).not.toMatch(/<button[^>]*disabled/);
  });

  it('disables both decisions while one is being submitted', () => {
    const { body } = renderPanel({ agent: agentFixture('awaiting_approval'), pending: 'approve' });

    expect(buttons(body)).toEqual(['Reject', 'Approving…']);
    expect(body.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it('shows a decision the Workflow did not accept', () => {
    const content = text(
      renderPanel({
        agent: agentFixture('awaiting_approval'),
        decisionError: 'shopping agent is not awaiting approval: status is approved',
      }).body,
    );

    expect(content).toContain('Decision not accepted');
    expect(content).toContain('shopping agent is not awaiting approval: status is approved');
  });

  it.each(['approved', 'purchasing'] as const)(
    'shows the purchase in progress once %s, without approval controls',
    (status) => {
      const { body } = renderPanel({ agent: agentFixture(status) });
      const content = text(body);

      expect(content).toContain('Purchasing');
      expect(content).toContain('Approved by jane@example.com');
      expect(buttons(body)).toEqual([]);
    },
  );

  it('keeps the approved proposal once purchased', () => {
    const content = text(renderPanel({ agent: agentFixture('purchased') }).body);

    expect(content).toContain('Purchased');
    expect(content).toContain('The agent has finished');
    expect(content).toContain('£82.99');
  });

  it('shows a rejected proposal as final', () => {
    const { body } = renderPanel({ agent: agentFixture('rejected') });
    const content = text(body);

    expect(content).toContain('Rejected');
    expect(content).toContain('Nothing was bought');
    expect(buttons(body)).toEqual([]);
  });

  it('explains why the agent could not satisfy a request', () => {
    const content = text(
      renderPanel({
        agent: agentFixture('failed', {
          proposal: undefined,
          explanation: 'The catalogue does not include a blender.',
        }),
      }).body,
    );

    expect(content).toContain('The agent could not complete the request');
    expect(content).toContain('The catalogue does not include a blender.');
  });

  it('shows a Workflow that ended without state', () => {
    const content = text(
      renderPanel({
        agent: { id: 'agent_123', status: 'failed', error: 'Terminated by operator' },
      }).body,
    );

    expect(content).toContain('Failed');
    expect(content).toContain('Terminated by operator');
  });

  it('keeps the last known state visible when a refresh fails', () => {
    const content = text(
      renderPanel({ agent: agentFixture('awaiting_approval'), error: 'Request timed out' }).body,
    );

    expect(content).toContain('Connection interrupted, retrying');
    expect(content).toContain('£82.99');
  });

  it('shows the selected AI failure scenario, which affects the agent only', () => {
    const content = text(
      renderPanel({
        agent: agentFixture('awaiting_approval', {
          demo: { scenario: 'ai_service_unavailable', inventoryFailures: 2 },
        }),
      }).body,
    );

    expect(content).toContain('Demo only · AI failure scenario AI service unavailable');
    expect(content).toContain('Affects this Shopping Agent only, not the Order it places.');
  });

  it('shows normal execution when no failures are simulated', () => {
    const content = text(
      renderPanel({ agent: agentFixture('planning', { demo: { scenario: 'none' } }) }).body,
    );

    expect(content).toContain('AI failure scenario Normal execution');
    expect(content).toContain('The agent is reading the catalogue');
    expect(content).not.toContain('simulated outage');
  });

  it('explains that Temporal is retrying a simulated outage while planning', () => {
    const content = text(
      renderPanel({
        agent: agentFixture('planning', { demo: { scenario: 'ai_service_unavailable' } }),
      }).body,
    );

    expect(content).toContain('Planning · AI service unavailable');
    expect(content).toContain('Temporal is retrying the planning automatically');
    expect(content).toContain('without repeating the catalogue retrieval');
    // No live attempt count is shown, as the dashboard does not observe retries
    expect(content).not.toMatch(/attempt \d/i);
  });
});
