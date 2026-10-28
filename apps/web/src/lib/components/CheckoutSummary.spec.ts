import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { checkoutFixture } from '../testing/fixtures';
import CheckoutSummary from './CheckoutSummary.svelte';

const noop = () => {};

function text(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('CheckoutSummary', () => {
  it('displays the created checkout with its ID, status, items and total', () => {
    const { body } = render(CheckoutSummary, {
      props: { checkout: checkoutFixture(), oncomplete: noop, onreset: noop },
    });
    const content = text(body);

    expect(content).toContain('chk_123');
    expect(content).toContain('Ready to complete');
    expect(content).toContain('Jane Doe · jane@example.com');
    expect(content).toContain('Stainless Steel Kettle');
    expect(content).toContain('£34.99');
    expect(content).toContain('Total £82.99');
    expect(content).toContain('Complete checkout');
    expect(content).toContain('gpay');
  });

  it('offers to retry when Order placement was not confirmed', () => {
    const { body } = render(CheckoutSummary, {
      props: {
        checkout: checkoutFixture({ status: 'complete_in_progress' }),
        oncomplete: noop,
        onreset: noop,
      },
    });

    expect(text(body)).toContain('Retry completion');
  });

  it('shows the Order placed by a completed checkout and no completion action', () => {
    const { body } = render(CheckoutSummary, {
      props: {
        checkout: checkoutFixture({
          status: 'completed',
          order: { id: 'ord_123', permalink_url: 'http://localhost:9999/orders/ord_123' },
        }),
        oncomplete: noop,
        onreset: noop,
      },
    });
    const content = text(body);

    expect(content).toContain('Completed');
    expect(content).toContain('Order placed');
    expect(content).not.toContain('Complete checkout');
  });

  it('shows UCP messages returned with the checkout', () => {
    const { body } = render(CheckoutSummary, {
      props: {
        checkout: checkoutFixture({
          status: 'incomplete',
          messages: [
            {
              type: 'error',
              code: 'missing',
              path: '$.buyer.email',
              content: 'Buyer email is required',
              severity: 'recoverable',
            },
          ],
        }),
        oncomplete: noop,
        onreset: noop,
      },
    });
    const content = text(body);

    expect(content).toContain('Buyer email is required');
    expect(content).toContain('Checkout cannot be completed');
    expect(content).not.toContain('Complete checkout');
  });
});
