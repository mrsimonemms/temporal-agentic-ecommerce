<script lang="ts" module>
  import type { StatusDisplay } from '$lib/format';

  export interface LineRow {
    id: string;
    title: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    total: number;
    fulfilled?: number;
    status?: StatusDisplay;
  }
</script>

<script lang="ts">
  import { formatAmount } from '$lib/format';

  import StatusBadge from './StatusBadge.svelte';

  let {
    rows,
    currency,
    total,
    fulfilment = false,
  }: { rows: LineRow[]; currency: string; total?: number; fulfilment?: boolean } = $props();
</script>

<!-- Scrolls within its panel on narrow screens rather than widening the page -->
<div class="table-scroll">
  <table>
    <thead>
      <tr>
        <th scope="col">Item</th>
        <th scope="col" class="number">Price</th>
        <th scope="col" class="number">Qty</th>
        {#if fulfilment}
          <th scope="col" class="number">Fulfilled</th>
          <th scope="col">Status</th>
        {/if}
        <th scope="col" class="number">Total</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.id)}
        <tr>
          <td>
            <span class="title">{row.title}</span>
            <span class="sku mono">{row.sku}</span>
          </td>
          <td class="number">{formatAmount(row.unitPrice, currency)}</td>
          <td class="number">{row.quantity}</td>
          {#if fulfilment}
            <td class="number">{row.fulfilled ?? 0} / {row.quantity}</td>
            <td>
              {#if row.status}
                <StatusBadge status={row.status} />
              {/if}
            </td>
          {/if}
          <td class="number">{formatAmount(row.total, currency)}</td>
        </tr>
      {/each}
    </tbody>
    {#if total !== undefined}
      <tfoot>
        <tr>
          <th scope="row" colspan={fulfilment ? 5 : 3}>Total</th>
          <td class="number grand-total">{formatAmount(total, currency)}</td>
        </tr>
      </tfoot>
    {/if}
  </table>
</div>

<style>
  .table-scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 0.75rem 0.5rem;
    text-align: left;
    vertical-align: middle;
  }

  th:first-child,
  td:first-child {
    padding-left: 0;
  }

  th:last-child,
  td:last-child {
    padding-right: 0;
  }

  thead th {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }

  tbody td {
    border-bottom: 1px solid var(--border);
  }

  .number {
    text-align: right;
    white-space: nowrap;
  }

  .title {
    display: block;
    font-weight: 600;
  }

  .sku {
    color: var(--muted);
    font-size: 0.8rem;
  }

  tfoot th {
    font-weight: 600;
    text-align: right;
  }

  .grand-total {
    font-size: 1.35rem;
    font-weight: 700;
  }
</style>
