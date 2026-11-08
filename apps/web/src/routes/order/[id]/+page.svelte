<script lang="ts">
  import type { Order } from '@ucp-js/sdk';

  import { resolve as resolvePath } from '$app/paths';

  import { isNotFound } from '$lib/agent';
  import Lifecycle from '$lib/components/Lifecycle.svelte';
  import OrderPanel from '$lib/components/OrderPanel.svelte';
  import type { WorkflowAction } from '$lib/components/WorkflowPanel.svelte';
  import WorkflowPanel from '$lib/components/WorkflowPanel.svelte';
  import {
    type OrderState,
    type ReportFulfilmentException,
    type ResolveFulfilmentException,
    fulfilOrder,
    fulfilmentOutcome,
    getOrderSnapshot,
    reportFulfilmentException,
    resolveFulfilmentException,
  } from '$lib/demo';
  import type { Feedback } from '$lib/format';
  import { startPolling } from '$lib/poll';
  import { ApiError } from '$lib/ucp';

  import type { PageProps } from './$types';

  // Frequent enough to observe Temporal retrying the inventory reservation,
  // which recovers within a few seconds
  const ORDER_POLL_INTERVAL_MS = 1000;

  let { params }: PageProps = $props();

  // Everything known about one Order. State for any other Order is ignored,
  // so nothing needs resetting when the ID in the URL changes and a late
  // response for a previous Order can never be shown.
  interface OrderView {
    id: string;
    order?: Order;
    workflow?: OrderState;
    // Latest polling failure, cleared by the next success
    error?: string;
    notFound?: boolean;
    updatedAt?: Date;
    // Action being submitted, and the outcome of the last one
    pending?: WorkflowAction;
    feedback?: Feedback;
  }

  let view = $state.raw<OrderView>({ id: '' });
  let current = $derived<OrderView>(view.id === params.id ? view : { id: params.id });

  // Restarts polling for the current Order, set while polling is active
  let restartPolling: (() => void) | undefined;

  function describe(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error';
  }

  // Applies changes for an Order, unless the URL has moved on to another
  function update(id: string, changes: Partial<OrderView>) {
    if (id === params.id) {
      view = { ...(view.id === id ? view : { id }), ...changes };
    }
  }

  // Polls the Order through the UCP endpoint and its internal Workflow state
  // through the demo endpoint. The Order continues independently, so polling
  // runs until the page or the ID changes. The teardown stops polling and
  // discards in-flight responses.
  $effect(() => {
    const id = params.id;

    const start = () =>
      startPolling((signal) => getOrderSnapshot(id, signal), {
        intervalMs: ORDER_POLL_INTERVAL_MS,
        onSuccess: ({ order, state }) =>
          update(id, { order, workflow: state, error: undefined, updatedAt: new Date() }),
        onError: (err) =>
          update(id, isNotFound(err) ? { notFound: true } : { error: describe(err) }),
        isPermanent: isNotFound,
      });

    let stop = start();
    restartPolling = () => {
      stop();
      stop = start();
    };

    return () => {
      stop();
      restartPolling = undefined;
    };
  });

  // Runs one action at a time, so repeated clicks cannot submit duplicates.
  // State confirmed by the API is applied and polling restarted, so an older
  // in-flight response cannot replace it.
  async function workflowAction(
    action: WorkflowAction,
    task: (id: string) => Promise<{ changes: Partial<OrderView>; feedback: Feedback }>,
  ): Promise<void> {
    const id = params.id;
    if (current.pending) {
      return;
    }
    update(id, { pending: action, feedback: undefined });
    try {
      const { changes, feedback } = await task(id);
      update(id, { ...changes, pending: undefined, feedback });
      if (id === params.id) {
        restartPolling?.();
      }
    } catch (err) {
      update(id, { pending: undefined, feedback: { tone: 'danger', message: describe(err) } });
    }
  }

  function report(request: ReportFulfilmentException) {
    return workflowAction('exception', async (id) => ({
      changes: { workflow: await reportFulfilmentException(id, request) },
      feedback: {
        tone: 'success',
        message: 'Exception accepted: the Order is awaiting intervention',
      },
    }));
  }

  function resolve(request: ResolveFulfilmentException) {
    return workflowAction('resolve', async (id) => ({
      changes: { workflow: await resolveFulfilmentException(id, request) },
      feedback: { tone: 'success', message: 'Alternative source approved: the Order is confirmed' },
    }));
  }

  function fulfil() {
    return workflowAction('fulfil', async (id) => {
      const order = await fulfilOrder(id);
      return { changes: { order }, feedback: fulfilmentOutcome(order) };
    });
  }
</script>

<svelte:head>
  <title>Order · Durable agentic commerce</title>
</svelte:head>

<Lifecycle workflow={current.workflow} />

{#if current.notFound}
  <section class="panel not-found" aria-labelledby="not-found-heading">
    <h2 id="not-found-heading">Order not found</h2>
    <p>No Order exists with this ID.</p>
    <p class="mono">{params.id}</p>
    <a class="button secondary" href={resolvePath('/')}>Back to the dashboard</a>
  </section>
{:else}
  <main>
    <div class="column">
      <OrderPanel
        orderId={params.id}
        order={current.order}
        error={current.error}
        updatedAt={current.updatedAt}
        pollIntervalMs={ORDER_POLL_INTERVAL_MS}
      />
    </div>

    <div class="column">
      <WorkflowPanel
        orderId={params.id}
        workflow={current.workflow}
        error={current.error}
        busy={current.pending !== undefined}
        pending={current.pending}
        feedback={current.feedback}
        onreport={report}
        onresolve={resolve}
        onfulfil={fulfil}
      />
    </div>
  </main>
{/if}

<style>
  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: stretch;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  .not-found {
    align-items: flex-start;
  }

  .not-found p {
    color: var(--muted);
  }

  @media (max-width: 1100px) {
    main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
