import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { exceptionFixture, orderStateFixture, resolutionFixture } from '../testing/fixtures';
import { text } from '../testing/text';
import WorkflowPanel from './WorkflowPanel.svelte';

const noop = () => {};
const handlers = { onreport: noop, onresolve: noop, onfulfil: noop };

function renderPanel(props: Partial<ComponentProps<typeof WorkflowPanel>>) {
  const { body } = render(WorkflowPanel, {
    props: { orderId: 'ord_123', ...handlers, ...props },
  });
  return { body, content: text(body) };
}

describe('WorkflowPanel', () => {
  it('waits for the checkout to complete before showing a Workflow', () => {
    const { content } = renderPanel({ orderId: undefined });

    expect(content).toContain('No Workflow yet');
  });

  it('distinguishes the operational view from the UCP Order', () => {
    const { content } = renderPanel({ workflow: orderStateFixture() });

    expect(content).toContain('Internal · Temporal Order Workflow');
    expect(content).toContain('Not part of the UCP Order');
  });

  it('explains that Temporal retries the configured inventory failures', () => {
    const { content } = renderPanel({
      workflow: orderStateFixture({
        status: 'reserving_inventory',
        inventoryReservationId: undefined,
      }),
      inventoryFailures: 2,
    });

    expect(content).toContain('Reserving inventory');
    expect(content).toContain('fail the first 2 attempts');
    expect(content).toContain('Temporal retries the reservation automatically');
    expect(content).toContain('Not yet reserved');
    expect(content).toContain('Controls become available once inventory is reserved');
    expect(content).not.toContain('Report fulfilment exception');
    expect(content).not.toContain('Mark fulfilled');
  });

  it('offers to report an exception or fulfil a confirmed Order', () => {
    const { body, content } = renderPanel({ workflow: orderStateFixture() });

    expect(content).toContain('Confirmed');
    expect(content).toContain('res_ord_123');
    expect(content).toContain('Report fulfilment exception');
    expect(content).toContain('Mark fulfilled');
    expect(content).not.toContain('Approve alternative source');
    // Defaults allow each step to be a single click, using the last line
    expect(body).toContain(`value="${exceptionFixture.reason}"`);
    expect(body).toMatch(/<option value="li_2"[^>]*selected/);
  });

  it('shows the exception and only offers approval while awaiting intervention', () => {
    const { body, content } = renderPanel({
      workflow: orderStateFixture({
        status: 'awaiting_intervention',
        fulfilment: { exception: exceptionFixture },
      }),
    });

    expect(content).toContain('Awaiting intervention');
    expect(content).toContain('Fulfilment exception');
    expect(content).toContain('Stoneware Mug Set (4 pack)');
    expect(content).toContain(exceptionFixture.reason);
    expect(content).toContain('Approve alternative source');
    expect(content).not.toContain('Mark fulfilled');
    expect(content).not.toContain('Report fulfilment exception');
    expect(body).toContain('value="ops@example.com"');
    expect(body).toMatch(/<option value="warehouse-north"[^>]*selected/);
  });

  it('shows the revised fulfilment plan and decision history', () => {
    const { content } = renderPanel({
      workflow: orderStateFixture({
        fulfilment: {
          sources: [{ lineId: 'li_2', source: 'warehouse-north' }],
          resolutions: [resolutionFixture],
        },
      }),
    });

    expect(content).toContain('fulfilment plan was revised');
    expect(content).toContain('Stainless Steel Kettle Original source');
    expect(content).toContain('Stoneware Mug Set (4 pack) Alternative · warehouse-north');
    expect(content).toContain('moved to warehouse-north , approved by ops@example.com');
  });

  it('offers no actions once the Order is fulfilled', () => {
    const { content } = renderPanel({
      workflow: orderStateFixture({ status: 'fulfilled', fulfilledAt: '2026-10-28T15:05:00Z' }),
    });

    expect(content).toContain('The Order was fulfilled at');
    expect(content).toContain('No further actions are available');
    expect(content).not.toContain('Mark fulfilled');
  });

  it('shows action feedback and progress', () => {
    const { content } = renderPanel({
      workflow: orderStateFixture(),
      busy: true,
      pending: 'exception',
      feedback: {
        tone: 'danger',
        message: 'The fulfilment exception was not accepted by Order "ord_123"',
      },
    });

    expect(content).toContain('Reporting…');
    expect(content).toContain('The fulfilment exception was not accepted by Order "ord_123"');
  });

  it('reports a failure to load the Workflow state', () => {
    const { content } = renderPanel({ error: 'The commerce API did not respond in time' });

    expect(content).toContain('Unable to load the Workflow state');
    expect(content).toContain('The commerce API did not respond in time');
  });
});
