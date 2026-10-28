<script lang="ts">
  import type { CheckoutResponse, Order } from '@ucp-js/sdk';

  import { orderStatus } from '$lib/format';

  let { checkout, order }: { checkout?: CheckoutResponse; order?: Order } = $props();

  // Only milestones visible through UCP are shown. Internal Workflow states,
  // such as inventory reservation, are not part of the UCP Order.
  let steps = $derived.by(() => {
    const status = order && orderStatus(order);
    const reached = [
      !!checkout,
      checkout?.status === 'completed',
      !!checkout?.order,
      !!order,
      status === 'fulfilled',
    ];

    return [
      { label: 'Checkout created', detail: 'UCP create checkout' },
      { label: 'Checkout completed', detail: 'Stubbed payment accepted' },
      { label: 'Order placed', detail: 'Temporal Order Workflow started' },
      { label: 'Processing', detail: 'Fulfilment in progress' },
      { label: 'Fulfilled', detail: 'All line items fulfilled' },
    ].map((step, index) => {
      const isLast = index === reached.length - 1;
      const done = reached[index] && (isLast || reached[index + 1]);
      return { ...step, state: done ? 'done' : reached[index] ? 'active' : 'pending' };
    });
  });
</script>

<nav class="lifecycle" aria-label="Commerce lifecycle">
  <div class="group checkout">
    <span class="eyebrow">Checkout · request and response</span>
  </div>
  <div class="group order">
    <span class="eyebrow">Order · durable, continues independently</span>
  </div>
  <ol>
    {#each steps as step, index (step.label)}
      <li class={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
        <span class="marker" aria-hidden="true">{step.state === 'done' ? '✓' : index + 1}</span>
        <span class="text">
          <span class="label">{step.label}</span>
          <span class="detail">{step.detail}</span>
        </span>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .lifecycle {
    display: grid;
    grid-template-columns: 2fr 3fr;
    column-gap: 1rem;
    row-gap: 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.5rem 1.25rem;
  }

  .group {
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--border);
  }

  .group.order {
    border-bottom-color: var(--accent);
  }

  .group.order .eyebrow {
    color: var(--accent);
  }

  ol {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--muted);
  }

  .marker {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    font-weight: 700;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .label {
    font-weight: 650;
    font-size: 1.05rem;
  }

  .detail {
    font-size: 0.85rem;
  }

  li.active {
    color: var(--text);
  }

  li.active .marker {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }

  li.done {
    color: var(--text);
  }

  li.done .marker {
    border-color: var(--success);
    background: var(--success);
    color: #fff;
  }

  li.done .detail,
  li.active .detail {
    color: var(--muted);
  }
</style>
