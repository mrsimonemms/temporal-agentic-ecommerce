import type { CheckoutResponse } from '@ucp-js/sdk';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { OrderState } from '../demo';
import {
  checkoutFixture,
  exceptionFixture,
  orderStateFixture,
  resolutionFixture,
} from '../testing/fixtures';
import Lifecycle from './Lifecycle.svelte';

// Returns the state of each step, keyed by position and label
function steps(checkout?: CheckoutResponse, workflow?: OrderState): string[] {
  const { body } = render(Lifecycle, { props: { checkout, workflow } });
  return [
    ...body.matchAll(/<li class="(\w+)[^"]*"[\s\S]*?<span class="label[^"]*">([^<]+)<\/span>/g),
  ].map(([, state, label]) => `${label}: ${state}`);
}

const completed = checkoutFixture({
  status: 'completed',
  order: { id: 'ord_123', permalink_url: 'http://localhost:9999/orders/ord_123' },
});

describe('Lifecycle', () => {
  it('starts with every step pending', () => {
    expect(steps().every((step) => step.endsWith('pending'))).toBe(true);
  });

  it('shows inventory reservation as current while Temporal retries it', () => {
    const result = steps(
      completed,
      orderStateFixture({ status: 'reserving_inventory', inventoryReservationId: undefined }),
    );

    expect(result.slice(0, 4)).toEqual([
      'Checkout created: done',
      'Checkout completed: done',
      'Reserving inventory: active',
      'Confirmed: pending',
    ]);
  });

  it('shows awaiting intervention as current once an exception is accepted', () => {
    const result = steps(
      completed,
      orderStateFixture({
        status: 'awaiting_intervention',
        fulfilment: { exception: exceptionFixture },
      }),
    );

    expect(result.slice(3, 7)).toEqual([
      'Confirmed: done',
      'Fulfilment exception: done',
      'Awaiting intervention: active',
      'Alternative approved: pending',
    ]);
  });

  it('shows the Order confirmed again after an alternative is approved', () => {
    const result = steps(
      completed,
      orderStateFixture({ fulfilment: { resolutions: [resolutionFixture] } }),
    );

    expect(result.slice(6)).toEqual([
      'Alternative approved: done',
      'Confirmed: active',
      'Fulfilled: pending',
    ]);
  });

  it('marks the exception path as skipped when the Order is fulfilled without one', () => {
    const result = steps(completed, orderStateFixture({ status: 'fulfilled' }));

    expect(result.slice(3)).toEqual([
      'Confirmed: done',
      'Fulfilment exception: skipped',
      'Awaiting intervention: skipped',
      'Alternative approved: skipped',
      'Confirmed: skipped',
      'Fulfilled: active',
    ]);
  });

  it('returns to awaiting intervention when a further exception is raised', () => {
    const result = steps(
      completed,
      orderStateFixture({
        status: 'awaiting_intervention',
        fulfilment: { exception: exceptionFixture, resolutions: [resolutionFixture] },
      }),
    );

    expect(result[5]).toBe('Awaiting intervention: active');
    expect(result[6]).toBe('Alternative approved: pending');
  });

  it('treats the checkout as completed when only the Order is known', () => {
    // The Order route loads the Order Workflow, not the checkout that placed it
    const result = steps(
      undefined,
      orderStateFixture({ status: 'reserving_inventory', inventoryReservationId: undefined }),
    );

    expect(result.slice(0, 3)).toEqual([
      'Checkout created: done',
      'Checkout completed: done',
      'Reserving inventory: active',
    ]);
  });
});
