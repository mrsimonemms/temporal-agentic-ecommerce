<script lang="ts">
  import type { CheckoutCreateRequest, CheckoutResponse, Order } from '@ucp-js/sdk';
  import { onMount } from 'svelte';

  import CheckoutForm from '$lib/components/CheckoutForm.svelte';
  import type { CheckoutAction } from '$lib/components/CheckoutSummary.svelte';
  import CheckoutSummary from '$lib/components/CheckoutSummary.svelte';
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
    setInventoryFailures,
  } from '$lib/demo';
  import type { Feedback } from '$lib/format';
  import { startPolling } from '$lib/poll';
  import {
    ApiError,
    completeCheckout,
    createCheckout,
    demoPaymentInstrument,
    getCheckout,
  } from '$lib/ucp';

  // Frequent enough to observe Temporal retrying the inventory reservation,
  // which recovers within a few seconds
  const ORDER_POLL_INTERVAL_MS = 1000;
  const CHECKOUT_STORAGE_KEY = 'ucp-dashboard.checkout-id';
  // The API does not expose the configured failures, so the value it
  // confirmed is remembered for each checkout
  const INVENTORY_STORAGE_PREFIX = 'ucp-dashboard.inventory-failures.';

  type Action = 'create' | 'restore' | CheckoutAction | WorkflowAction;

  let checkout = $state.raw<CheckoutResponse>();
  let inventoryFailures = $state<number>();
  let pending = $state<Action>();
  let actionError = $state<string>();
  let inventoryFeedback = $state<Feedback>();
  let workflowFeedback = $state<Feedback>();

  let order = $state.raw<Order>();
  let workflow = $state.raw<OrderState>();
  let orderError = $state<string>();
  let orderUpdatedAt = $state<Date>();

  let busy = $derived(pending !== undefined);

  // The Order is selected by the reference returned when the checkout completes
  let orderId = $derived(checkout?.order?.id);
  // Never display an Order other than the selected one
  let currentOrder = $derived(order?.id === orderId ? order : undefined);
  let currentWorkflow = $derived(workflow?.id === orderId ? workflow : undefined);

  // Restarts polling for the selected Order, set while polling is active
  let restartPolling: (() => void) | undefined;

  function describe(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error';
  }

  function storedInventoryFailures(checkoutId: string): number | undefined {
    const value = sessionStorage.getItem(INVENTORY_STORAGE_PREFIX + checkoutId);
    return value === null ? undefined : Number(value);
  }

  // Remembers the checkout for this browser tab so the dashboard survives a
  // page reload during a demo
  function selectCheckout(next: CheckoutResponse | undefined) {
    if (next?.id !== checkout?.id) {
      order = undefined;
      workflow = undefined;
      orderError = undefined;
      orderUpdatedAt = undefined;
      inventoryFeedback = undefined;
      workflowFeedback = undefined;
      if (checkout) {
        sessionStorage.removeItem(INVENTORY_STORAGE_PREFIX + checkout.id);
      }
      if (next) {
        sessionStorage.setItem(CHECKOUT_STORAGE_KEY, next.id);
        inventoryFailures = storedInventoryFailures(next.id);
      } else {
        sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
        inventoryFailures = undefined;
      }
    }
    checkout = next;
  }

  // Runs one action at a time, so repeated clicks cannot submit duplicates.
  // Returns the error message if the action failed.
  async function perform(action: Action, task: () => Promise<void>): Promise<string | undefined> {
    if (pending) {
      return undefined;
    }
    pending = action;
    try {
      await task();
      return undefined;
    } catch (err) {
      return describe(err);
    } finally {
      pending = undefined;
    }
  }

  async function create(request: CheckoutCreateRequest) {
    actionError = undefined;
    actionError = await perform('create', async () => {
      const created = await createCheckout(request);
      // New checkouts have no simulated failures until configured
      sessionStorage.setItem(INVENTORY_STORAGE_PREFIX + created.id, '0');
      selectCheckout(created);
    });
  }

  async function complete() {
    const current = checkout;
    const instrument = current && demoPaymentInstrument(current);
    if (!current || !instrument) {
      return;
    }
    actionError = undefined;
    actionError = await perform('complete', async () =>
      selectCheckout(
        await completeCheckout(current.id, { payment: { instruments: [instrument] } }),
      ),
    );
  }

  function reset() {
    actionError = undefined;
    selectCheckout(undefined);
  }

  async function configureInventory(failures: number) {
    const current = checkout;
    if (!current) {
      return;
    }
    inventoryFeedback = undefined;
    const error = await perform('inventory', async () => {
      const result = await setInventoryFailures(current.id, failures);
      sessionStorage.setItem(INVENTORY_STORAGE_PREFIX + current.id, String(result.failures));
      inventoryFailures = result.failures;
    });
    inventoryFeedback = error
      ? { tone: 'danger', message: error }
      : {
          tone: 'success',
          message:
            failures === 0
              ? 'Saved: inventory reservation will succeed first time'
              : `Saved: the first ${failures} reservation ${failures === 1 ? 'attempt' : 'attempts'} will fail`,
        };
  }

  // Applies Workflow state confirmed by the API and restarts polling so an
  // older in-flight response cannot replace it
  function applyWorkflow(state: OrderState) {
    workflow = state;
    restartPolling?.();
  }

  async function workflowAction(
    action: WorkflowAction,
    task: (id: string) => Promise<Feedback>,
  ): Promise<void> {
    const id = orderId;
    if (!id) {
      return;
    }
    workflowFeedback = undefined;
    let feedback: Feedback | undefined;
    const error = await perform(action, async () => {
      feedback = await task(id);
    });
    workflowFeedback = error ? { tone: 'danger', message: error } : feedback;
  }

  function report(request: ReportFulfilmentException) {
    return workflowAction('exception', async (id) => {
      applyWorkflow(await reportFulfilmentException(id, request));
      return { tone: 'success', message: 'Exception accepted: the Order is awaiting intervention' };
    });
  }

  function resolve(request: ResolveFulfilmentException) {
    return workflowAction('resolve', async (id) => {
      applyWorkflow(await resolveFulfilmentException(id, request));
      return { tone: 'success', message: 'Alternative source approved: the Order is confirmed' };
    });
  }

  function fulfil() {
    return workflowAction('fulfil', async (id) => {
      const result = await fulfilOrder(id);
      order = result;
      restartPolling?.();
      return fulfilmentOutcome(result);
    });
  }

  onMount(() => {
    const id = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
    if (!id) {
      return;
    }
    void perform('restore', async () => {
      try {
        selectCheckout(await getCheckout(id));
      } catch (err) {
        // Forget a checkout that no longer exists, but keep it while the API
        // is unavailable so a later reload can restore it
        if (err instanceof ApiError && err.messages.some((m) => m.code === 'not_found')) {
          sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
        }
        throw err;
      }
    }).then((error) => {
      actionError = error;
    });
  });

  // Polls the selected Order through the UCP endpoint and its internal
  // Workflow state through the demo endpoint. The teardown runs when the Order
  // changes or the page is destroyed, stopping polling and discarding
  // in-flight responses.
  $effect(() => {
    const id = orderId;
    if (!id) {
      return;
    }

    const start = () =>
      startPolling((signal) => getOrderSnapshot(id, signal), {
        intervalMs: ORDER_POLL_INTERVAL_MS,
        onSuccess: (snapshot) => {
          order = snapshot.order;
          workflow = snapshot.state;
          orderError = undefined;
          orderUpdatedAt = new Date();
        },
        onError: (err) => {
          orderError = describe(err);
        },
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
</script>

<svelte:head>
  <title>Temporal × UCP · Order lifecycle</title>
</svelte:head>

<div class="dashboard">
  <header>
    <div class="brand">
      <span class="logo" aria-hidden="true">T×U</span>
      <div>
        <h1>Order lifecycle</h1>
        <p>Universal Commerce Protocol checkout, durable Order execution with Temporal</p>
      </div>
    </div>
    <p class="tagline">Agents can buy. Can your systems deliver?</p>
  </header>

  <Lifecycle {checkout} workflow={currentWorkflow} />

  {#if actionError}
    <div class="notice danger" role="alert">
      <strong>Request failed</strong>
      <p>{actionError}</p>
    </div>
  {/if}

  <main>
    <div class="column">
      {#if checkout}
        <CheckoutSummary
          {checkout}
          {busy}
          pending={pending === 'complete' || pending === 'inventory' ? pending : undefined}
          {inventoryFailures}
          {inventoryFeedback}
          oncomplete={complete}
          onreset={reset}
          onconfigureinventory={configureInventory}
        />
      {:else}
        <CheckoutForm {busy} oncreate={create} />
      {/if}
    </div>

    <div class="column">
      <OrderPanel
        {orderId}
        order={currentOrder}
        error={orderError}
        updatedAt={orderUpdatedAt}
        pollIntervalMs={ORDER_POLL_INTERVAL_MS}
      />
    </div>

    <div class="column">
      <WorkflowPanel
        {orderId}
        workflow={currentWorkflow}
        error={orderError}
        {inventoryFailures}
        {busy}
        pending={pending === 'exception' || pending === 'resolve' || pending === 'fulfil'
          ? pending
          : undefined}
        feedback={workflowFeedback}
        onreport={report}
        onresolve={resolve}
        onfulfil={fulfil}
      />
    </div>
  </main>
</div>

<style>
  .dashboard {
    max-width: 120rem;
    min-height: 100vh;
    margin: 0 auto;
    padding: 1rem 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .logo {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 0.6rem;
    background: var(--text);
    color: #fff;
    font-weight: 800;
    font-size: 0.95rem;
    letter-spacing: -0.02em;
  }

  h1 {
    font-size: 1.9rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .brand p {
    color: var(--muted);
  }

  .tagline {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--accent);
  }

  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 5fr) minmax(0, 5fr);
    gap: 1.25rem;
    align-items: stretch;
  }

  /* Each column stacks panels, so demo controls can be added beneath them */
  .column {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  @media (max-width: 1500px) {
    main {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    main > :last-child {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 1100px) {
    main {
      grid-template-columns: minmax(0, 1fr);
    }

    main > :last-child {
      grid-column: auto;
    }
  }
</style>
