<script lang="ts">
  import type { CheckoutResponse } from '@ucp-js/sdk';

  import { checkoutStatus, totalOf } from '$lib/format';
  import { demoPaymentInstrument } from '$lib/ucp';

  import CopyValue from './CopyValue.svelte';
  import LineItems from './LineItems.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let {
    checkout,
    busy = false,
    oncomplete,
    onreset,
  }: {
    checkout: CheckoutResponse;
    busy?: boolean;
    oncomplete: () => void;
    onreset: () => void;
  } = $props();

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
          · card ending {instrument.display?.last_digits}
        </span>
        <button type="button" class="button primary" onclick={oncomplete} disabled={busy}>
          {#if busy}
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

  .payment {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
