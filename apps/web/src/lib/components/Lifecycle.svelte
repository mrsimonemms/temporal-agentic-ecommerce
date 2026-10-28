<script lang="ts">
  import type { CheckoutResponse } from '@ucp-js/sdk';

  import type { OrderState } from '$lib/demo';

  let { checkout, workflow }: { checkout?: CheckoutResponse; workflow?: OrderState } = $props();

  type StepState = 'done' | 'active' | 'skipped' | 'pending';

  // Each milestone is only shown as reached once the API has reported it.
  // The exception path is optional, so it is marked as skipped when a later
  // milestone is reached without it.
  let steps = $derived.by(() => {
    const exception = workflow?.fulfilment.exception;
    const resolved = (workflow?.fulfilment.resolutions?.length ?? 0) > 0 && !exception;
    const reached = [
      !!checkout,
      checkout?.status === 'completed',
      !!workflow,
      !!workflow?.inventoryReservationId,
      !!exception || resolved,
      !!exception || resolved,
      resolved,
      resolved,
      workflow?.status === 'fulfilled',
    ];

    return [
      { label: 'Checkout created', detail: 'UCP checkout' },
      { label: 'Checkout completed', detail: 'Stubbed payment' },
      { label: 'Reserving inventory', detail: 'Retried by Temporal' },
      { label: 'Confirmed', detail: 'Inventory reserved' },
      { label: 'Fulfilment exception', detail: 'Reported by supplier' },
      { label: 'Awaiting intervention', detail: 'Human decision' },
      { label: 'Alternative approved', detail: 'Plan revised' },
      { label: 'Confirmed', detail: 'Ready to fulfil' },
      { label: 'Fulfilled', detail: 'Order complete' },
    ].map((step, index) => {
      const laterReached = reached.slice(index + 1).some(Boolean);
      const state: StepState = reached[index]
        ? laterReached
          ? 'done'
          : 'active'
        : laterReached
          ? 'skipped'
          : 'pending';
      return { ...step, state };
    });
  });
</script>

<nav class="lifecycle" aria-label="Commerce lifecycle">
  <div class="group checkout">
    <span class="eyebrow">Checkout · UCP</span>
  </div>
  <div class="group order">
    <span class="eyebrow">Order · durable Temporal Workflow, continues independently</span>
  </div>
  <ol>
    {#each steps as step, index (index)}
      <li class={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
        <span class="marker" aria-hidden="true">{step.state === 'done' ? '✓' : index + 1}</span>
        <span class="text">
          <span class="label">{step.label}</span>
          <span class="detail">{step.state === 'skipped' ? 'Not needed' : step.detail}</span>
        </span>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .lifecycle {
    display: grid;
    grid-template-columns: 2fr 7fr;
    column-gap: 0.75rem;
    row-gap: 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1.5rem 1rem;
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
    grid-template-columns: repeat(9, minmax(0, 1fr));
    gap: 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--muted);
  }

  .marker {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    font-weight: 700;
    font-size: 0.9rem;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .label {
    font-weight: 650;
    font-size: 0.95rem;
    line-height: 1.25;
  }

  .detail {
    font-size: 0.8rem;
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

  li.skipped {
    opacity: 0.55;
  }

  li.skipped .marker {
    border-style: dashed;
  }
</style>
