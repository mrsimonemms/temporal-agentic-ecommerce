import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { orderFixture } from '../testing/fixtures';
import OrderPanel from './OrderPanel.svelte';

const pollIntervalMs = 2000;

function text(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('OrderPanel', () => {
  it('explains that no Order exists before checkout completes', () => {
    const { body } = render(OrderPanel, { props: { pollIntervalMs } });

    expect(text(body)).toContain('No Order yet');
  });

  it('shows a loading state until the Order has been retrieved', () => {
    const { body } = render(OrderPanel, { props: { orderId: 'ord_123', pollIntervalMs } });

    expect(text(body)).toContain('Loading Order');
    expect(text(body)).toContain('ord_123');
  });

  it('displays the Order line items, prices, fulfilment state and permalink', () => {
    const { body } = render(OrderPanel, {
      props: { orderId: 'ord_123', order: orderFixture(), pollIntervalMs },
    });
    const content = text(body);

    expect(content).toContain('ord_123');
    expect(content).toContain('Placed by checkout chk_123');
    expect(content).toContain('Stainless Steel Kettle');
    expect(content).toContain('Stoneware Mug Set (4 pack)');
    expect(content).toContain('£24.00');
    expect(content).toContain('£48.00');
    expect(content).toContain('Total £82.99');
    expect(content).toContain('0 / 2');
    expect(content).toContain('Processing');
    expect(content).toContain('In progress');
    expect(content).toContain('Live');
    expect(body).toContain('href="http://localhost:9999/orders/ord_123"');
  });

  it('shows when the Order has been fulfilled', () => {
    const { body } = render(OrderPanel, {
      props: { orderId: 'ord_123', order: orderFixture('fulfilled'), pollIntervalMs },
    });
    const content = text(body);

    expect(content).toContain('Every line item has been fulfilled');
    expect(content).toContain('2 / 2');
    expect(content).not.toContain('Processing');
  });

  it('keeps the last known Order visible when a refresh fails', () => {
    const { body } = render(OrderPanel, {
      props: {
        orderId: 'ord_123',
        order: orderFixture(),
        error: 'The commerce API did not respond in time',
        updatedAt: new Date(),
        pollIntervalMs,
      },
    });
    const content = text(body);

    expect(content).toContain('Connection interrupted, retrying');
    expect(content).toContain('The commerce API did not respond in time');
    expect(content).toContain('Reconnecting');
    expect(content).toContain('Stainless Steel Kettle');
  });

  it('reports a failure to load the Order', () => {
    const { body } = render(OrderPanel, {
      props: { orderId: 'ord_123', error: 'Order "ord_123" was not found', pollIntervalMs },
    });

    expect(text(body)).toContain('Unable to load the Order');
    expect(text(body)).toContain('Order "ord_123" was not found');
  });
});
