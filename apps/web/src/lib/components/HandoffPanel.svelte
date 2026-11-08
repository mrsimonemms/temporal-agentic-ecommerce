<script lang="ts">
  import { resolve } from '$app/paths';

  import type { AgentState } from '$lib/agent';
  import { failuresLabel } from '$lib/format';

  import CopyValue from './CopyValue.svelte';

  let { agent }: { agent?: AgentState } = $props();

  let failures = $derived(agent?.demo?.inventoryFailures ?? 0);
  let purchasing = $derived(agent?.status === 'approved' || agent?.status === 'purchasing');
  let failedAfterApproval = $derived(
    agent?.status === 'failed' && agent.decision?.decision === 'approve',
  );
</script>

<section class="panel" aria-labelledby="handoff-heading">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Hand-off · checkout</p>
      <h2 id="handoff-heading">Purchase and Order</h2>
    </div>
  </div>

  <p class="explainer">
    Once approved, the agent buys through the merchant's checkout, like any other customer. Creating
    and completing the checkout are separate Temporal Activities: a failure is retried on its own,
    without repeating the AI planning. Completing the checkout places an Order, which runs in its
    own Order Workflow.
  </p>

  {#if agent}
    <div class="demo-control">
      <div class="demo-heading">
        <span class="eyebrow">Demo only · inventory failures</span>
        <span class="configured">{failuresLabel(failures)}</span>
      </div>
      <p class="hint">
        {failures === 0
          ? 'Inventory will be reserved first time.'
          : `Set when the request started. The first ${failures} reservation ${failures === 1 ? 'attempt' : 'attempts'} for the Order will fail.`}
      </p>
    </div>
  {/if}

  {#if agent?.checkoutId || agent?.orderId}
    <div class="references">
      {#if agent.checkoutId}
        <CopyValue label="Checkout ID" value={agent.checkoutId} />
      {/if}
      {#if agent.orderId}
        <CopyValue label="Order ID" value={agent.orderId} />
      {/if}
    </div>
  {/if}

  {#if agent?.status === 'purchased' && agent.orderId}
    <div class="notice success" role="status">
      <strong>The agent's work is done</strong>
      <p>
        Its responsibility ended when the Order was placed. Delivering the Order is the merchant's
        obligation: it continues in its own Workflow, through inventory, exceptions and fulfilment,
        without the agent.
      </p>
    </div>
    <a class="button primary follow" href={resolve('/order/[id]', { id: agent.orderId })}>
      Follow the Order →
    </a>
  {:else if purchasing}
    <div class="notice info" role="status">
      <strong>Checkout in progress</strong>
      <p>
        Temporal is creating and completing the checkout. If the commerce API is unavailable, each
        step is retried until it succeeds.
      </p>
    </div>
  {:else if agent?.status === 'rejected'}
    <p class="empty">No checkout was created, so no Order exists.</p>
  {:else if failedAfterApproval}
    <p class="empty">The purchase did not complete, so no Order was placed.</p>
  {:else if agent?.status !== 'failed'}
    <p class="empty">The checkout and Order references appear here after approval.</p>
  {/if}
</section>

<style>
  .explainer,
  .empty {
    color: var(--muted);
  }

  .references {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .follow {
    align-self: flex-start;
  }
</style>
