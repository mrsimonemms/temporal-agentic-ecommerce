<script lang="ts" module>
  export type CheckoutAction = 'complete' | 'inventory';
</script>

<script lang="ts">
  import type { CheckoutResponse } from '@ucp-js/sdk';

  import { type Feedback, checkoutStatus, totalOf } from '$lib/format';
  import { demoPaymentInstrument } from '$lib/ucp';

  import CopyValue from './CopyValue.svelte';
  import LineItems from './LineItems.svelte';
  import StatusBadge from './StatusBadge.svelte';

  const INVENTORY_FAILURE_CHOICES = [0, 1, 2];

  let {
    checkout,
    busy = false,
    pending,
    inventoryFailures,
    inventoryFeedback,
    oncomplete,
    onreset,
    onconfigureinventory,
  }: {
    checkout: CheckoutResponse;
    busy?: boolean;
    pending?: CheckoutAction;
    // Value confirmed by the API, or undefined when not known in this session
    inventoryFailures?: number;
    inventoryFeedback?: Feedback;
    oncomplete: () => void;
    onreset: () => void;
    onconfigureinventory: (failures: number) => void;
  } = $props();

  function failuresLabel(failures: number): string {
    return failures === 0 ? 'None' : `${failures} ${failures === 1 ? 'failure' : 'failures'}`;
  }

  let rows = $derived(
    checkout.line_items.map((lineItem) => ({
      id: lineItem.id,
      title: lineItem.item.title,
      sku: lineItem.item.id,
      unitPrice: lineItem.item.price,
      quantity: lineItem.quantity,
      total: totalOf(lineItem.totals, 'total') ?? lineItem.item.price * lineItem.quantity,
    })),
  );

  let buyerName = $derived(
    [checkout.buyer?.first_name, checkout.buyer?.last_name].filter(Boolean).join(' '),
  );

  let instrument = $derived(demoPaymentInstrument(checkout));
  let canComplete = $derived(
    !!instrument &&
      (checkout.status === 'ready_for_complete' || checkout.status === 'complete_in_progress'),
  );

  // The API only accepts changes before completion starts
  let inventoryConfigurable = $derived(
    checkout.status === 'incomplete' || checkout.status === 'ready_for_complete',
  );
</script>

<section class="panel" aria-labelledby="checkout-heading">
  <div class="panel-header">
    <div>
      <p class="eyebrow">UCP checkout</p>
      <h2 id="checkout-heading">Checkout</h2>
    </div>
    <StatusBadge status={checkoutStatus(checkout.status)} large />
  </div>

  <div class="meta">
    <CopyValue label="Checkout ID" value={checkout.id} />
    {#if checkout.buyer?.email}
      <div class="buyer">
        <span class="eyebrow">Buyer</span>
        <span>{buyerName ? `${buyerName} · ` : ''}{checkout.buyer.email}</span>
      </div>
    {/if}
  </div>

  <LineItems {rows} currency={checkout.currency} total={totalOf(checkout.totals, 'total')} />

  {#if checkout.messages?.length}
    <ul class="messages">
      {#each checkout.messages as message, index (index)}
        <li class={['notice', message.type === 'error' ? 'danger' : message.type]}>
          <p>{message.content}</p>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="demo-control">
    <div class="demo-heading">
      <span class="eyebrow">Demo only · inventory failures</span>
      <span class="configured">
        {inventoryFailures === undefined ? 'Not known' : failuresLabel(inventoryFailures)}
      </span>
    </div>
    {#if inventoryConfigurable}
      <div class="choices" role="group" aria-label="Simulated inventory failures">
        {#each INVENTORY_FAILURE_CHOICES as failures (failures)}
          <button
            type="button"
            class={['choice', { selected: inventoryFailures === failures }]}
            aria-pressed={inventoryFailures === failures}
            disabled={busy}
            onclick={() => failures !== inventoryFailures && onconfigureinventory(failures)}
          >
            {failuresLabel(failures)}
          </button>
        {/each}
      </div>
      <p class={['hint', inventoryFeedback?.tone]} role="status">
        {inventoryFeedback?.message ?? 'Applies to this checkout only. Not sent through UCP.'}
      </p>
    {:else}
      <p class="hint">Locked once completion has started.</p>
    {/if}
  </div>

  {#if checkout.status === 'completed' && checkout.order}
    <div class="notice success">
      <strong>Order placed</strong>
      <p>
        Checkout is finished. The Order reference returned by UCP is shown alongside, where its
        progress continues.
      </p>
    </div>
  {:else if checkout.status === 'complete_in_progress'}
    <div class="notice warning">
      <strong>Order placement not yet confirmed</strong>
      <p>Completing again resumes placement without creating a second Order.</p>
    </div>
  {:else if checkout.status === 'incomplete'}
    <div class="notice warning">
      <strong>Checkout cannot be completed</strong>
      <p>Required information is missing. Start a new checkout to continue.</p>
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="button secondary" onclick={onreset} disabled={busy}>
      New checkout
    </button>
    {#if canComplete && instrument}
      <div class="complete">
        <span class="payment">
          Stubbed payment ·
          <span class="mono">{instrument.handler_id}</span>
          · •••• {instrument.display?.last_digits}
        </span>
        <button type="button" class="button primary" onclick={oncomplete} disabled={busy}>
          {#if pending === 'complete'}
            Completing…
          {:else if checkout.status === 'complete_in_progress'}
            Retry completion
          {:else}
            Complete checkout
          {/if}
        </button>
      </div>
    {/if}
  </div>
</section>

<style>
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2rem;
  }

  .buyer {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .messages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .complete {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.4rem;
    margin-left: auto;
  }

  .demo-control {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface-muted);
  }

  .demo-heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }

  .configured {
    font-weight: 650;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .choice {
    font: inherit;
    font-weight: 600;
    padding: 0.6rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .choice.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .choice:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .hint {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .hint.success {
    color: var(--success);
    font-weight: 600;
  }

  .hint.warning {
    color: var(--warning);
    font-weight: 600;
  }

  .hint.danger {
    color: var(--danger);
    font-weight: 600;
  }

  .payment {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
