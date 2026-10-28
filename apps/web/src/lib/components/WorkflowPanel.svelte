<script lang="ts" module>
  export type WorkflowAction = 'exception' | 'resolve' | 'fulfil';
</script>

<script lang="ts">
  import type {
    OrderState,
    ReportFulfilmentException,
    ResolveFulfilmentException,
  } from '$lib/demo';
  import { type Feedback, formatTime, workflowStatus } from '$lib/format';

  import StatusBadge from './StatusBadge.svelte';

  const ALTERNATIVE_SOURCES = [
    { id: 'warehouse-north', label: 'North warehouse' },
    { id: 'warehouse-south', label: 'South warehouse' },
    { id: 'supplier-direct', label: 'Direct from supplier' },
  ];

  let {
    orderId,
    workflow,
    error,
    inventoryFailures,
    busy = false,
    pending,
    feedback,
    onreport,
    onresolve,
    onfulfil,
  }: {
    orderId?: string;
    workflow?: OrderState;
    error?: string;
    inventoryFailures?: number;
    busy?: boolean;
    pending?: WorkflowAction;
    feedback?: Feedback;
    onreport: (request: ReportFulfilmentException) => void;
    onresolve: (request: ResolveFulfilmentException) => void;
    onfulfil: () => void;
  } = $props();

  // Defaults chosen so each step of the demo is a single click
  let selectedLine = $state<string>();
  let reason = $state('Supplier reports the item is unavailable at the selected warehouse');
  let alternativeSource = $state(ALTERNATIVE_SOURCES[0].id);
  let approvedBy = $state('ops@example.com');
  let note = $state('Same item, ships a day later');

  let lineId = $derived(selectedLine ?? workflow?.lines.at(-1)?.id ?? '');
  let exception = $derived(workflow?.fulfilment.exception);
  let resolutions = $derived(workflow?.fulfilment.resolutions ?? []);

  function lineTitle(id: string): string {
    const line = workflow?.lines.find((l) => l.id === id);
    return line?.title ?? line?.productId ?? id;
  }

  function sourceOf(id: string): string | undefined {
    return workflow?.fulfilment.sources?.find((s) => s.lineId === id)?.source;
  }

  function report(event: SubmitEvent) {
    event.preventDefault();
    onreport({ lineId, reason: reason.trim() });
  }

  function resolve(event: SubmitEvent) {
    event.preventDefault();
    if (!exception) {
      return;
    }
    onresolve({
      lineId: exception.lineId,
      alternativeSource,
      approvedBy: approvedBy.trim(),
      note: note.trim() || undefined,
    });
  }
</script>

<section class="panel workflow" aria-labelledby="workflow-heading">
  <div class="panel-header">
    <div>
      <p class="eyebrow internal">Internal · Temporal Order Workflow</p>
      <h2 id="workflow-heading">Workflow state</h2>
    </div>
    {#if workflow}
      <StatusBadge status={workflowStatus(workflow.status)} large />
    {/if}
  </div>

  <p class="scope">Demo-only operational view of the Workflow. Not part of the UCP Order.</p>

  {#if !orderId}
    <div class="empty">
      <p class="empty-title">No Workflow yet</p>
      <p>The Order Workflow starts when the checkout completes.</p>
    </div>
  {:else if !workflow}
    <div class="empty">
      {#if error}
        <p class="empty-title">Unable to load the Workflow state</p>
        <p>{error}</p>
      {:else}
        <p class="empty-title">Loading Workflow state…</p>
      {/if}
    </div>
  {:else}
    {#if workflow.status === 'reserving_inventory'}
      <div class="notice info" role="status">
        <strong>Reserving inventory</strong>
        <p>
          {#if inventoryFailures}
            The inventory service is set to fail the first {inventoryFailures}
            {inventoryFailures === 1 ? 'attempt' : 'attempts'}. Temporal retries the reservation
            automatically until it succeeds.
          {:else}
            Waiting for the inventory service to reserve stock. Failed attempts are retried
            automatically by Temporal.
          {/if}
        </p>
      </div>
    {:else if workflow.status === 'confirmed'}
      <div class="notice success" role="status">
        <strong>Confirmed</strong>
        <p>
          Inventory is reserved{resolutions.length > 0
            ? ' and the fulfilment plan was revised'
            : ''}. The Order is ready to fulfil.
        </p>
      </div>
    {:else if workflow.status === 'awaiting_intervention'}
      <div class="notice warning" role="status">
        <strong>Awaiting intervention</strong>
        <p>
          Fulfilment is paused until someone decides how to proceed. The Workflow waits durably, for
          minutes or months, without losing state.
        </p>
      </div>
    {:else}
      <div class="notice success" role="status">
        <strong>Fulfilled</strong>
        <p>
          The Order was fulfilled{workflow.fulfilledAt
            ? ` at ${formatTime(workflow.fulfilledAt)}`
            : ''}.
        </p>
      </div>
    {/if}

    {#if exception}
      <div class="exception">
        <span class="eyebrow">Fulfilment exception · raised {formatTime(exception.raisedAt)}</span>
        <p class="exception-line">{lineTitle(exception.lineId)}</p>
        <p>{exception.reason}</p>
      </div>
    {/if}

    <div class="controls">
      <p class="eyebrow">Demo controls · simulate external events</p>

      {#if workflow.status === 'confirmed'}
        <form class="control" onsubmit={report}>
          <div class="fields">
            <label>
              Line
              <select bind:value={() => lineId, (value) => (selectedLine = value)} disabled={busy}>
                {#each workflow.lines as line (line.id)}
                  <option value={line.id}>{line.title ?? line.productId}</option>
                {/each}
              </select>
            </label>
            <label class="wide">
              Reason
              <input type="text" bind:value={reason} required disabled={busy} />
            </label>
          </div>
          <div class="buttons">
            <button type="submit" class="button primary" disabled={busy || !reason.trim()}>
              {pending === 'exception' ? 'Reporting…' : 'Report fulfilment exception'}
            </button>
            <button type="button" class="button secondary" onclick={onfulfil} disabled={busy}>
              {pending === 'fulfil' ? 'Fulfilling…' : 'Mark fulfilled'}
            </button>
          </div>
        </form>
      {:else if workflow.status === 'awaiting_intervention' && exception}
        <form class="control" onsubmit={resolve}>
          <div class="fields">
            <label>
              Alternative source
              <select bind:value={alternativeSource} disabled={busy}>
                {#each ALTERNATIVE_SOURCES as option (option.id)}
                  <option value={option.id}>{option.label}</option>
                {/each}
              </select>
            </label>
            <label>
              Approved by
              <input type="text" bind:value={approvedBy} required disabled={busy} />
            </label>
            <label class="wide">
              Note
              <input type="text" bind:value={note} disabled={busy} />
            </label>
          </div>
          <div class="buttons">
            <button type="submit" class="button primary" disabled={busy || !approvedBy.trim()}>
              {pending === 'resolve' ? 'Approving…' : 'Approve alternative source'}
            </button>
          </div>
        </form>
      {:else if workflow.status === 'reserving_inventory'}
        <p class="muted">Controls become available once inventory is reserved.</p>
      {:else}
        <p class="muted">The Order is fulfilled. No further actions are available.</p>
      {/if}

      {#if feedback}
        <p class={['notice', feedback.tone]} role="status">{feedback.message}</p>
      {/if}
    </div>

    <dl class="facts">
      <div>
        <dt class="eyebrow">Inventory reservation</dt>
        <dd>
          {#if workflow.inventoryReservationId}
            <code>{workflow.inventoryReservationId}</code>
          {:else}
            <span class="muted">Not yet reserved</span>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="eyebrow">Workflow started</dt>
        <dd>{formatTime(workflow.createdAt)}</dd>
      </div>
    </dl>

    <div>
      <h3 class="eyebrow">Fulfilment plan</h3>
      <ul class="plan">
        {#each workflow.lines as line (line.id)}
          {@const source = sourceOf(line.id)}
          <li>
            <span>{line.title ?? line.productId}</span>
            {#if source}
              <span class="source alternative">Alternative · <code>{source}</code></span>
            {:else}
              <span class="source">Original source</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>

    {#if resolutions.length > 0}
      <div>
        <h3 class="eyebrow">Decisions</h3>
        <ol class="history">
          {#each resolutions as resolution (resolution.resolvedAt)}
            <li>
              <strong>{lineTitle(resolution.lineId)}</strong> moved to
              <code>{resolution.alternativeSource}</code>, approved by {resolution.approvedBy} at
              {formatTime(resolution.resolvedAt)}
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  {/if}
</section>

<style>
  .workflow {
    height: 100%;
    border-top: 4px solid var(--accent);
  }

  .internal {
    color: var(--accent);
  }

  .scope {
    font-size: 0.85rem;
    color: var(--muted);
    margin-top: -0.5rem;
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

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2rem;
    margin: 0;
  }

  .facts div {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--muted);
  }

  .exception {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warning);
    border-radius: 0.5rem;
    background: var(--warning-soft);
  }

  .exception .eyebrow {
    color: var(--warning);
  }

  .exception-line {
    font-weight: 650;
  }

  .plan,
  .history {
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .plan {
    list-style: none;
  }

  .plan li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .history {
    padding-left: 1.25rem;
    font-size: 0.95rem;
  }

  .source {
    color: var(--muted);
    white-space: nowrap;
  }

  .source.alternative {
    color: var(--accent);
    font-weight: 600;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface-muted);
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--muted);
  }

  input,
  select {
    font: inherit;
    font-weight: 400;
    color: var(--text);
    background: var(--surface);
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  input:focus-visible,
  select:focus-visible {
    outline: 3px solid var(--accent-soft);
    border-color: var(--accent);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
