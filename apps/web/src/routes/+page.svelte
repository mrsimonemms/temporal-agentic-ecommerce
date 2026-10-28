<script lang="ts">
  import type { CheckoutCreateRequest, CheckoutResponse, Order } from '@ucp-js/sdk';
  import { onMount } from 'svelte';

  import CheckoutForm from '$lib/components/CheckoutForm.svelte';
  import CheckoutSummary from '$lib/components/CheckoutSummary.svelte';
  import Lifecycle from '$lib/components/Lifecycle.svelte';
  import OrderPanel from '$lib/components/OrderPanel.svelte';
  import { startPolling } from '$lib/poll';
  import {
    ApiError,
    completeCheckout,
    createCheckout,
    demoPaymentInstrument,
    getCheckout,
    getOrder,
  } from '$lib/ucp';

  const ORDER_POLL_INTERVAL_MS = 2000;
  const CHECKOUT_STORAGE_KEY = 'ucp-dashboard.checkout-id';

  let checkout = $state.raw<CheckoutResponse>();
  let busy = $state(false);
  let actionError = $state<string>();

  let order = $state.raw<Order>();
  let orderError = $state<string>();
  let orderUpdatedAt = $state<Date>();

  // The Order is selected by the reference returned when the checkout completes
  let orderId = $derived(checkout?.order?.id);
  // Never display an Order other than the selected one
  let currentOrder = $derived(order?.id === orderId ? order : undefined);

  function describe(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error';
  }

  // Remembers the checkout for this browser tab so the dashboard survives a
  // page reload during a demo
  function selectCheckout(next: CheckoutResponse | undefined) {
    if (next?.id !== checkout?.id) {
      order = undefined;
      orderError = undefined;
      orderUpdatedAt = undefined;
      if (next) {
        sessionStorage.setItem(CHECKOUT_STORAGE_KEY, next.id);
      } else {
        sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
      }
    }
    checkout = next;
  }

  async function run(action: () => Promise<void>) {
    busy = true;
    actionError = undefined;
    try {
      await action();
    } catch (err) {
      actionError = describe(err);
    } finally {
      busy = false;
    }
  }

  function create(request: CheckoutCreateRequest) {
    return run(async () => selectCheckout(await createCheckout(request)));
  }

  function complete() {
    const current = checkout;
    const instrument = current && demoPaymentInstrument(current);
    if (!current || !instrument) {
      return;
    }
    return run(async () =>
      selectCheckout(
        await completeCheckout(current.id, { payment: { instruments: [instrument] } }),
      ),
    );
  }

  function reset() {
    actionError = undefined;
    selectCheckout(undefined);
  }

  onMount(() => {
    const id = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
    if (!id) {
      return;
    }
    void run(async () => {
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
    });
  });

  // Polls the selected Order. The teardown runs when the Order changes or the
  // page is destroyed, stopping polling and discarding in-flight responses.
  $effect(() => {
    const id = orderId;
    if (!id) {
      return;
    }

    return startPolling((signal) => getOrder(id, signal), {
      intervalMs: ORDER_POLL_INTERVAL_MS,
      onSuccess: (value) => {
        order = value;
        orderError = undefined;
        orderUpdatedAt = new Date();
      },
      onError: (err) => {
        orderError = describe(err);
      },
    });
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

  <Lifecycle {checkout} order={currentOrder} />

  {#if actionError}
    <div class="notice danger" role="alert">
      <strong>Request failed</strong>
      <p>{actionError}</p>
    </div>
  {/if}

  <main>
    <div class="column">
      {#if checkout}
        <CheckoutSummary {checkout} {busy} oncomplete={complete} onreset={reset} />
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
  </main>
</div>

<style>
  .dashboard {
    max-width: 120rem;
    min-height: 100vh;
    margin: 0 auto;
    padding: 1.5rem 2rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
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
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
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

  @media (max-width: 1100px) {
    main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
