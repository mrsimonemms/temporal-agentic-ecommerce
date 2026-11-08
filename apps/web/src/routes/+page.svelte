<script lang="ts">
  import type { CheckoutCreateRequest, CheckoutResponse } from '@ucp-js/sdk';

  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import { type StartAgentRequest, startShoppingAgent } from '$lib/agent';
  import AgentStartForm from '$lib/components/AgentStartForm.svelte';
  import CheckoutForm from '$lib/components/CheckoutForm.svelte';
  import type { CheckoutAction } from '$lib/components/CheckoutSummary.svelte';
  import CheckoutSummary from '$lib/components/CheckoutSummary.svelte';
  import Lifecycle from '$lib/components/Lifecycle.svelte';
  import { setInventoryFailures } from '$lib/demo';
  import type { Feedback } from '$lib/format';
  import { ApiError, completeCheckout, createCheckout, demoPaymentInstrument } from '$lib/ucp';

  type Action = 'start' | 'create' | CheckoutAction;

  // A manual checkout that has not yet placed an Order. It only lives on this
  // page: once completion places an Order the dashboard moves to its route.
  let checkout = $state.raw<CheckoutResponse>();
  let inventoryFailures = $state<number>();
  let inventoryFeedback = $state<Feedback>();
  let pending = $state<Action>();
  let agentError = $state<string>();
  let checkoutError = $state<string>();

  let busy = $derived(pending !== undefined);

  function describe(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error';
  }

  function reset() {
    checkout = undefined;
    inventoryFailures = undefined;
    inventoryFeedback = undefined;
    agentError = undefined;
    checkoutError = undefined;
  }

  // The logo links here, so following it from this page also starts afresh.
  // Nothing is cancelled: Workflows already started keep running.
  afterNavigate(({ type }) => {
    if (type !== 'enter') {
      reset();
    }
  });

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

  async function startAgent(request: StartAgentRequest) {
    agentError = undefined;
    agentError = await perform('start', async () => {
      const { id } = await startShoppingAgent(request);
      await goto(resolve('/agent/[id]', { id }));
    });
  }

  async function create(request: CheckoutCreateRequest) {
    checkoutError = undefined;
    checkoutError = await perform('create', async () => {
      checkout = await createCheckout(request);
      // New checkouts have no simulated failures until configured
      inventoryFailures = 0;
      inventoryFeedback = undefined;
    });
  }

  async function complete() {
    const current = checkout;
    const instrument = current && demoPaymentInstrument(current);
    if (!current || !instrument) {
      return;
    }
    checkoutError = undefined;
    checkoutError = await perform('complete', async () => {
      const completed = await completeCheckout(current.id, {
        payment: { instruments: [instrument] },
      });
      checkout = completed;
      if (completed.order) {
        await goto(resolve('/order/[id]', { id: completed.order.id }));
      }
    });
  }

  async function configureInventory(failures: number) {
    const current = checkout;
    if (!current) {
      return;
    }
    inventoryFeedback = undefined;
    const error = await perform('inventory', async () => {
      inventoryFailures = (await setInventoryFailures(current.id, failures)).failures;
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
</script>

<svelte:head>
  <title>Agents can buy. Can your systems deliver? · Durable agentic commerce</title>
</svelte:head>

{#if checkout}
  <Lifecycle {checkout} />
{/if}

<main>
  <div class="column">
    <AgentStartForm {busy} pending={pending === 'start'} error={agentError} onstart={startAgent} />
  </div>

  <div class="column">
    {#if checkoutError}
      <div class="notice danger" role="alert">
        <strong>Request failed</strong>
        <p>{checkoutError}</p>
      </div>
    {/if}

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
</main>

<style>
  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
  }

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
