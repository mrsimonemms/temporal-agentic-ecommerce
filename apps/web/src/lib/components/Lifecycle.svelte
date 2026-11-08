<script lang="ts">
  import type { CheckoutResponse } from '@ucp-js/sdk';

  import type { OrderState } from '$lib/demo';

  let { checkout, workflow }: { checkout?: CheckoutResponse; workflow?: OrderState } = $props();

  type StepState = 'done' | 'active' | 'skipped' | 'pending';

  // The first steps belong to the UCP checkout, the remainder to the Order
  const CHECKOUT_STEPS = 2;

  // Each milestone is only shown as reached once the API has reported it.
  // The exception path is optional, so it is marked as skipped when a later
  // milestone is reached without it.
  let steps = $derived.by(() => {
    const exception = workflow?.fulfilment.exception;
    const resolved = (workflow?.fulfilment.resolutions?.length ?? 0) > 0 && !exception;
    // An Order Workflow only exists once its checkout has completed, so the
    // checkout steps are reached even when the checkout itself is not loaded
    const reached = [
      !!checkout || !!workflow,
      checkout?.status === 'completed' || !!workflow,
      !!workflow,
      !!workflow?.inventoryReservationId,
      !!exception || resolved,
      !!exception || resolved,
      resolved,
      resolved,
      workflow?.status === 'fulfilled',
    ];

    return [
      { label: 'Checkout created', detail: 'Buyer and items' },
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

{#snippet stage(step: (typeof steps)[number], number: number)}
  <li class={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
    <span class="marker" aria-hidden="true">{step.state === 'done' ? '✓' : number}</span>
    <span class="text">
      <span class="label">{step.label}</span>
      <span class="detail">{step.state === 'skipped' ? 'Not needed' : step.detail}</span>
    </span>
  </li>
{/snippet}

<nav class="lifecycle" aria-label="Commerce lifecycle">
  <div class="stages">
    <div class="group checkout">
      <div class="heading"><span class="eyebrow">Checkout</span></div>
      <ol>
        {#each steps.slice(0, CHECKOUT_STEPS) as step, index (index)}
          {@render stage(step, index + 1)}
        {/each}
      </ol>
    </div>
    <div class="group order">
      <div class="heading">
        <span class="eyebrow">Order · durable Temporal Workflow, continues independently</span>
      </div>
      <ol start={CHECKOUT_STEPS + 1}>
        {#each steps.slice(CHECKOUT_STEPS) as step, index (index)}
          {@render stage(step, CHECKOUT_STEPS + index + 1)}
        {/each}
      </ol>
    </div>
  </div>
</nav>

<style>
  /*
   * The panel is a size container so the layout responds to the width actually
   * available to the stages (its content box, excluding padding) rather than to
   * the viewport, which also has to accommodate the dashboard's own padding.
   */
  .lifecycle {
    container: lifecycle / inline-size;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1.5rem 1rem;
  }

  .stages {
    display: grid;
    grid-template-columns: 2fr 7fr;
    column-gap: 0.75rem;
    row-gap: 0.6rem;
  }

  /* When horizontal, the groups' headings and lists share the outer grid */
  .group {
    display: contents;
  }

  .heading {
    grid-row: 1;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--border);
  }

  .order .heading {
    border-bottom-color: var(--accent);
  }

  .order .eyebrow {
    color: var(--accent);
  }

  /*
   * Both lists span the full row with the same nine columns, so the stages
   * line up as one sequence with the Order stages starting in column three
   */
  ol {
    grid-row: 2;
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr));
    gap: 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .order li:first-child {
    grid-column: 3;
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

  /* Phones need less padding so the stacked stages keep as much width as possible */
  @media (max-width: 768px) {
    .lifecycle {
      padding: 1rem;
    }
  }

  /*
   * Below the wide single row, the layout steps down by the panel's content
   * width, keeping every stage column at least as wide as in the single row
   * (about 9.5rem) so the longest words never run into the next stage:
   *
   * - 92rem and wider: one row of nine stages
   * - 72rem to 92rem: each group on its own row, seven columns
   * - 41rem to 72rem: each group on its own row, four columns
   * - narrower: each group stacks vertically
   *
   * Every size in the component is in rem, so these hold at any root font size.
   * The Order group's seven stages split evenly across seven or four columns,
   * and the checkout group shares the same columns so the stages line up.
   */
  @container lifecycle (width < 92rem) {
    .stages {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 1.25rem;
    }

    .group {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    ol {
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 1rem 0.75rem;
      padding-left: 0.25rem;
    }

    .order li:first-child {
      grid-column: auto;
    }

    li {
      align-items: flex-start;
    }

    .text {
      padding-top: 0.15rem;
    }
  }

  @container lifecycle (width < 72rem) {
    ol {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @container lifecycle (width < 41rem) {
    ol {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.6rem;
    }
  }
</style>
