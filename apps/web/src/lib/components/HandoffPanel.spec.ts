import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { agentFixture } from '../testing/fixtures';
import { text } from '../testing/text';
import HandoffPanel from './HandoffPanel.svelte';

describe('HandoffPanel', () => {
  it('explains what happens after approval', () => {
    const content = text(render(HandoffPanel, { props: { agent: agentFixture() } }).body);

    expect(content).toContain('without repeating the AI planning');
    expect(content).toContain('The checkout and Order references appear here after approval');
  });

  it('shows the inventory failures set when the request started', () => {
    const content = text(
      render(HandoffPanel, {
        props: { agent: agentFixture('awaiting_approval', { demo: { inventoryFailures: 2 } }) },
      }).body,
    );

    expect(content).toContain('Demo only · inventory failures');
    expect(content).toContain('2 failures');
    expect(content).toContain('The first 2 reservation attempts for the Order will fail');
  });

  it('defaults to no simulated failures', () => {
    const content = text(render(HandoffPanel, { props: { agent: agentFixture() } }).body);

    expect(content).toContain('None');
    expect(content).toContain('Inventory will be reserved first time');
  });

  it('shows the checkout in progress', () => {
    const content = text(
      render(HandoffPanel, { props: { agent: agentFixture('purchasing') } }).body,
    );

    expect(content).toContain('Checkout in progress');
    expect(content).not.toContain('Follow the Order');
  });

  it('hands over to the independent Order once purchased', () => {
    const { body } = render(HandoffPanel, { props: { agent: agentFixture('purchased') } });
    const content = text(body);

    expect(content).toContain("The agent's work is done");
    expect(content).toContain('continues in its own Workflow');
    expect(content).toContain('chk_123');
    expect(content).toContain('ord_123');
    expect(content).toContain('Follow the Order');
    expect(body).toContain('href="/order/ord_123"');
  });

  it('explains that a rejected proposal places no Order', () => {
    const { body } = render(HandoffPanel, { props: { agent: agentFixture('rejected') } });

    expect(text(body)).toContain('No checkout was created, so no Order exists');
    expect(body).not.toContain('/order/');
  });

  it('explains a purchase that failed after approval', () => {
    const content = text(
      render(HandoffPanel, {
        props: {
          agent: agentFixture('failed', { decision: agentFixture('purchasing').decision }),
        },
      }).body,
    );

    expect(content).toContain('The purchase did not complete, so no Order was placed');
  });
});
