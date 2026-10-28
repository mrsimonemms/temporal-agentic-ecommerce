import { type Order } from '@ucp-js/sdk';

// Minimal buyer-facing Order page served at the Order permalink. It renders
// the same UCP Order representation returned by the API.

const LINE_STATUS_LABELS: Record<Order['line_items'][number]['status'], string> = {
  processing: 'Processing',
  partial: 'Partially fulfilled',
  fulfilled: 'Fulfilled',
  removed: 'Removed',
};

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Amounts are integers in the currency's minor unit
function formatAmount(amount: number, currency: string): string {
  const format = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}

function orderStatus(order: Order): string {
  const statuses = new Set(order.line_items.map((lineItem) => lineItem.status));
  if (statuses.size === 1) {
    return LINE_STATUS_LABELS[[...statuses][0]];
  }
  return statuses.has('fulfilled') || statuses.has('partial')
    ? LINE_STATUS_LABELS.partial
    : LINE_STATUS_LABELS.processing;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid #ddd; padding: 0.5rem; text-align: left; }
td.amount, th.amount { text-align: right; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderOrderPage(order: Order): string {
  const total = order.totals.find((t) => t.type === 'total')?.amount ?? 0;

  const rows = order.line_items
    .map(
      (lineItem) => `<tr>
<td>${escapeHtml(lineItem.item.title)}</td>
<td>${escapeHtml(lineItem.quantity.total)}</td>
<td>${escapeHtml(lineItem.quantity.fulfilled)}</td>
<td>${escapeHtml(LINE_STATUS_LABELS[lineItem.status])}</td>
<td class="amount">${escapeHtml(formatAmount(lineItem.totals.find((t) => t.type === 'total')?.amount ?? 0, order.currency))}</td>
</tr>`,
    )
    .join('\n');

  return page(
    `Order ${order.id}`,
    `<h1>Order ${escapeHtml(order.id)}</h1>
<p>Status: <strong>${escapeHtml(orderStatus(order))}</strong></p>
<table>
<thead>
<tr><th>Item</th><th>Quantity</th><th>Fulfilled</th><th>Status</th><th class="amount">Total</th></tr>
</thead>
<tbody>
${rows}
</tbody>
<tfoot>
<tr><th colspan="4">Order total</th><th class="amount">${escapeHtml(formatAmount(total, order.currency))}</th></tr>
</tfoot>
</table>`,
  );
}

export function renderOrderNotFoundPage(id: string): string {
  return page(
    'Order not found',
    `<h1>Order not found</h1>
<p>No order exists with the reference ${escapeHtml(id)}.</p>`,
  );
}
