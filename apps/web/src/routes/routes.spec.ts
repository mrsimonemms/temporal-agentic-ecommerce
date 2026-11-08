import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { text } from '../lib/testing/text';
import Layout from './+layout.svelte';
import RootPage from './+page.svelte';
import AgentPage from './agent/[id]/+page.svelte';
import OrderPage from './order/[id]/+page.svelte';

// Server-renders a route as on a direct visit or refresh. State is then loaded
// in the browser from the ID in the URL, so the rendered page identifies the
// execution it will show.

describe('routes', () => {
  it('renders the shared header with a logo returning to a fresh dashboard', () => {
    const { body } = render(Layout, { props: { children: (() => {}) as never } });
    const content = text(body);

    expect(content).toContain('Durable agentic commerce');
    expect(content).toContain('Agents can buy. Can your systems deliver?');
    expect(body).toMatch(/<a href="\/" class="logo[^"]*" aria-label="Start again"/);
  });

  it('starts / afresh with the agent and manual checkout', () => {
    const { body, head } = render(RootPage, { props: { data: {}, params: {} } as never });
    const content = text(body);

    expect(head).toContain(
      '<title>Agents can buy. Can your systems deliver? · Durable agentic commerce</title>',
    );
    expect(content).toContain('Ask the agent to buy');
    expect(content).toContain('Start shopping agent');
    expect(content).toContain('Or buy manually');
    expect(content).toContain('Buy directly without using AI');
    expect(content).toContain('Create checkout');
    // No previous execution is restored
    expect(content).not.toContain('Checkout ID');
  });

  it('renders /agent/[id] for the agent in the URL', () => {
    const { body, head } = render(AgentPage, {
      props: { data: {}, params: { id: 'agent_abc' } } as never,
    });
    const content = text(body);

    expect(head).toContain('<title>Shopping agent · Durable agentic commerce</title>');
    expect(content).toContain('Loading shopping agent');
    expect(content).toContain('agent_abc');
    expect(content).toContain('Shopping agent · durable Temporal Workflow');
  });

  it('renders /order/[id] for the Order in the URL', () => {
    const { body, head } = render(OrderPage, {
      props: { data: {}, params: { id: 'ord_abc' } } as never,
    });
    const content = text(body);

    expect(head).toContain('<title>Order · Durable agentic commerce</title>');
    expect(content).toContain('Loading Order');
    expect(content).toContain('ord_abc');
    expect(content).toContain('Workflow state');
    expect(content).toContain('Order · durable Temporal Workflow, continues independently');
  });
});
