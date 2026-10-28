<script lang="ts">
  import type { Order } from '@ucp-js/sdk';

  import { lineItemStatus, orderStatus, totalOf } from '$lib/format';

  import CopyValue from './CopyValue.svelte';
  import LineItems from './LineItems.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let {
    orderId,
    order,
    error,
    updatedAt,
    pollIntervalMs,
  }: {
    orderId?: string;
    order?: Order;
    error?: string;
    updatedAt?: Date;
    pollIntervalMs: number;
  } = $props();

  let status = $derived(order && orderStatus(order));

  let rows = $derived(
    order?.line_items.map((lineItem) => ({
      id: lineItem.id,
      title: lineItem.item.title,
      sku: lineItem.item.id,
      unitPrice: lineItem.item.price,
      quantity: lineItem.quantity.total,
      fulfilled: lineItem.quantity.fulfilled,
      status: lineItemStatus(lineItem.status),
      total: totalOf(lineItem.totals, 'total') ?? lineItem.item.price * lineItem.quantity.total,
    })) ?? [],
  );

  let events = $derived(order?.fulfillment.events ?? []);

  let every = $derived(
    pollIntervalMs === 1000 ? 'every second' : `every ${pollIntervalMs / 1000} seconds`,
  );

  function time(date: Date): string {
    return date.toLocaleTimeString('en-GB');
  }
</script>

<section class="panel order" aria-labelledby="order-heading" aria-busy={!!orderId && !order}>
  <div class="panel-header">
    <div>
      <p class="eyebrow">UCP order · durable, coordinated by Temporal</p>
      <h2 id="order-heading">Order</h2>
    </div>
    {#if status}
      <StatusBadge status={lineItemStatus(status)} large />
    {/if}
  </div>

  {#if !orderId}
    <div class="empty">
      <p class="empty-title">No Order yet</p>
      <p>
        Completing the checkout places an Order and starts its Temporal Order Workflow. From that
        point the Order progresses on its own, independently of the checkout and this dashboard.
      </p>
    </div>
  {:else if !order}
    <div class="empty">
      {#if error}
        <p class="empty-title">Unable to load the Order</p>
        <p>{error}. Retrying {every}.</p>
      {:else}
        <p class="empty-title">Loading Order…</p>
      {/if}
      <p class="mono">{orderId}</p>
    </div>
  {:else}
    {#if error}
      <div class="notice warning" role="status">
        <strong>Connection interrupted, retrying</strong>
        <p>
          {error}. Showing the last known state{updatedAt ? ` from ${time(updatedAt)}` : ''}. The
          Order itself continues in Temporal.
        </p>
      </div>
    {:else if status === 'fulfilled'}
      <div class="notice success" role="status">
        <strong>Fulfilled</strong>
        <p>Every line item has been fulfilled.</p>
      </div>
    {:else if status === 'removed'}
      <div class="notice info" role="status">
        <strong>Removed</strong>
        <p>Every line item has been removed from the Order.</p>
      </div>
    {:else}
      <div class="notice info" role="status">
        <strong>In progress</strong>
        <p>
          The Order Workflow is coordinating fulfilment. The checkout interaction has ended, so
          progress no longer depends on it.
        </p>
      </div>
    {/if}

    <div class="meta">
      <CopyValue label="Order ID" value={order.id} />
      <div class="placed-by">
        <span class="eyebrow">Placed by checkout</span>
        <code>{order.checkout_id}</code>
      </div>
      <a
        class="button secondary permalink"
        href={order.permalink_url}
        target="_blank"
        rel="external noopener"
      >
        Open buyer order page ↗
      </a>
    </div>

    <LineItems {rows} currency={order.currency} total={totalOf(order.totals, 'total')} fulfilment />

    {#if events.length > 0}
      <div>
        <h3 class="eyebrow">Fulfilment events</h3>
        <ol class="events">
          {#each events as event (event.id)}
            <li>
              <strong>{event.type}</strong>
              {#if event.description}<span>{event.description}</span>{/if}
              <time datetime={event.occurred_at}>{time(new Date(event.occurred_at))}</time>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  {/if}

  {#if orderId}
    <footer class={['live', { stale: !!error }]}>
      <span class="dot" aria-hidden="true"></span>
      {#if error}
        Reconnecting
      {:else}
        Live
      {/if}
      · refreshing {every}
      {#if updatedAt}
        · last updated {time(updatedAt)}
      {/if}
    </footer>
  {/if}
</section>

<style>
  .order {
    height: 100%;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    color: var(--muted);
    font-size: 1.1rem;
  }

  .empty-title {
    font-size: 1.4rem;
    font-weight: 650;
    color: var(--text);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1rem 2rem;
  }

  .placed-by {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .placed-by code {
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .permalink {
    margin-left: auto;
  }

  .events {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .events li {
    display: flex;
    gap: 0.75rem;
  }

  .events time {
    color: var(--muted);
    margin-left: auto;
  }

  .live {
    margin-top: auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.9rem;
    color: var(--muted);
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--success);
  }

  .stale .dot {
    background: var(--warning);
  }
</style>
