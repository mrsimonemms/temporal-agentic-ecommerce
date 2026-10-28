import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { checkoutFixture } from '../testing/fixtures';
import { text } from '../testing/text';
import CheckoutSummary from './CheckoutSummary.svelte';

const noop = () => {};
const handlers = { oncomplete: noop, onreset: noop, onconfigureinventory: noop };

describe('CheckoutSummary', () => {
  it('displays the created checkout with its ID, status, items and total', () => {
    const { body } = render(CheckoutSummary, {
      props: { checkout: checkoutFixture(), ...handlers },
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
        ...handlers,
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
        ...handlers,
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
        ...handlers,
      },
    });
    const content = text(body);

    expect(content).toContain('Buyer email is required');
    expect(content).toContain('Checkout cannot be completed');
    expect(content).not.toContain('Complete checkout');
  });

  describe('inventory failure control', () => {
    it('offers zero, one or two failures before completion and shows the configured value', () => {
      const { body } = render(CheckoutSummary, {
        props: { checkout: checkoutFixture(), inventoryFailures: 2, ...handlers },
      });
      const content = text(body);

      expect(content).toContain('Demo only · inventory failures');
      expect(content).toContain('None 1 failure 2 failures');
      expect(body).toMatch(/aria-pressed="true"[^>]*>\s*2 failures/);
      expect(content).toContain('Not sent through UCP');
    });

    it('locks the configuration once completion has started', () => {
      for (const status of ['complete_in_progress', 'completed'] as const) {
        const { body } = render(CheckoutSummary, {
          props: { checkout: checkoutFixture({ status }), inventoryFailures: 1, ...handlers },
        });
        const content = text(body);

        expect(content).toContain('Locked once completion has started');
        expect(content).toContain('1 failure');
        expect(body).not.toContain('aria-pressed');
      }
    });

    it('shows when the configured value is not known in this session', () => {
      const { body } = render(CheckoutSummary, {
        props: { checkout: checkoutFixture(), ...handlers },
      });

      expect(text(body)).toContain('Not known');
    });

    it('shows the outcome of the last change', () => {
      const { body } = render(CheckoutSummary, {
        props: {
          checkout: checkoutFixture(),
          inventoryFailures: 0,
          inventoryFeedback: { tone: 'danger', message: 'Checkout "chk_123" was not found' },
          ...handlers,
        },
      });

      expect(text(body)).toContain('Checkout "chk_123" was not found');
    });

    it('only labels the completion button as completing while completing', () => {
      const { body } = render(CheckoutSummary, {
        props: { checkout: checkoutFixture(), busy: true, pending: 'inventory', ...handlers },
      });

      expect(text(body)).toContain('Complete checkout');
      expect(text(body)).not.toContain('Completing');
    });
  });
});
