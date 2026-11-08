import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { AgentState } from '../agent';
import { agentFixture } from '../testing/fixtures';
import { text } from '../testing/text';
import AgentLifecycle from './AgentLifecycle.svelte';

// Returns the state of each step, keyed by label
function steps(agent?: AgentState): string[] {
  const { body } = render(AgentLifecycle, { props: { agent } });
  return [
    ...body.matchAll(/<li class="(\w+)[^"]*"[\s\S]*?<span class="label[^"]*">([^<]+)<\/span>/g),
  ].map(([, state, label]) => `${label}: ${state}`);
}

describe('AgentLifecycle', () => {
  it('separates the agent from the Order it hands over to', () => {
    const content = text(render(AgentLifecycle, { props: {} }).body);

    expect(content).toContain('Shopping agent · durable Temporal Workflow');
    expect(content).toContain('Order · its own Workflow');
  });

  it('starts with every step pending', () => {
    expect(steps().every((step) => step.endsWith('pending'))).toBe(true);
  });

  it('shows planning as current while the agent selects products', () => {
    expect(steps(agentFixture('planning'))).toEqual([
      'Planning: active',
      'Proposal ready: pending',
      'Awaiting approval: pending',
      'Purchasing: pending',
      'Purchased: pending',
      'Order placed: pending',
    ]);
  });

  it('shows the proposal awaiting a human decision', () => {
    expect(steps(agentFixture('awaiting_approval'))).toEqual([
      'Planning: done',
      'Proposal ready: done',
      'Awaiting approval: active',
      'Purchasing: pending',
      'Purchased: pending',
      'Order placed: pending',
    ]);
  });

  it.each(['approved', 'purchasing'] as const)('shows purchasing once %s', (status) => {
    expect(steps(agentFixture(status)).slice(2, 5)).toEqual([
      'Awaiting approval: done',
      'Purchasing: active',
      'Purchased: pending',
    ]);
  });

  it('shows the agent finished and the Order placed once purchased', () => {
    expect(steps(agentFixture('purchased'))).toEqual([
      'Planning: done',
      'Proposal ready: done',
      'Awaiting approval: done',
      'Purchasing: done',
      'Purchased: done',
      'Order placed: done',
    ]);
    expect(
      text(render(AgentLifecycle, { props: { agent: agentFixture('purchased') } }).body),
    ).toContain('Continues independently');
  });

  it('shows a rejected proposal without a purchase or Order', () => {
    const agent = agentFixture('rejected');

    expect(steps(agent)).toEqual([
      'Planning: done',
      'Proposal ready: done',
      'Awaiting approval: done',
      'Purchasing: skipped',
      'Purchased: skipped',
      'Order placed: skipped',
    ]);
    expect(text(render(AgentLifecycle, { props: { agent } }).body)).toContain('Rejected');
  });

  it('shows where the agent failed', () => {
    expect(steps(agentFixture('failed', { proposal: undefined })).slice(0, 2)).toEqual([
      'Planning: failed',
      'Proposal ready: skipped',
    ]);
    expect(
      steps(agentFixture('failed', { decision: agentFixture('purchasing').decision })).slice(2),
    ).toEqual([
      'Awaiting approval: done',
      'Purchasing: failed',
      'Purchased: skipped',
      'Order placed: skipped',
    ]);
  });
});
