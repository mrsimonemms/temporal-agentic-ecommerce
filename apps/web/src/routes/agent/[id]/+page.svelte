<script lang="ts">
  import {
    type AgentState,
    type PurchaseDecision,
    decidePurchase,
    getShoppingAgent,
    isFinal,
    isNotFound,
  } from '$lib/agent';
  import AgentLifecycle from '$lib/components/AgentLifecycle.svelte';
  import AgentPanel from '$lib/components/AgentPanel.svelte';
  import HandoffPanel from '$lib/components/HandoffPanel.svelte';
  import { startPolling } from '$lib/poll';
  import { ApiError } from '$lib/ucp';

  import type { PageProps } from './$types';

  // Frequent enough to follow the agent from planning through purchase
  const AGENT_POLL_INTERVAL_MS = 1000;

  let { params }: PageProps = $props();

  // Everything known about one agent. State for any other agent is ignored,
  // so nothing needs resetting when the ID in the URL changes and a late
  // response for a previous agent can never be shown.
  interface AgentView {
    id: string;
    agent?: AgentState;
    // Latest polling failure, cleared by the next success
    error?: string;
    notFound?: boolean;
    // Decision being submitted
    pending?: PurchaseDecision;
    decisionError?: string;
  }

  let view = $state.raw<AgentView>({ id: '' });
  let current = $derived<AgentView>(view.id === params.id ? view : { id: params.id });

  // Restarts polling for the current agent, set while polling is active
  let restartPolling: (() => void) | undefined;

  function describe(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error';
  }

  // Applies changes for an agent, unless the URL has moved on to another
  function update(id: string, changes: Partial<AgentView>) {
    if (id === params.id) {
      view = { ...(view.id === id ? view : { id }), ...changes };
    }
  }

  // Polls the agent in the URL until it finishes. The page is reused when only
  // the ID changes, so the teardown stops polling the previous agent and
  // discards its in-flight responses.
  $effect(() => {
    const id = params.id;

    const start = () =>
      startPolling((signal) => getShoppingAgent(id, signal), {
        intervalMs: AGENT_POLL_INTERVAL_MS,
        onSuccess: (agent) => update(id, { agent, error: undefined }),
        onError: (err) =>
          update(id, isNotFound(err) ? { notFound: true } : { error: describe(err) }),
        isFinal,
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

  // Success is only shown once the Workflow has accepted the decision. The
  // purchase itself happens in the Workflow, not here.
  async function decide(decision: PurchaseDecision) {
    const id = params.id;
    const agent = current.agent;
    if (current.pending || agent?.status !== 'awaiting_approval' || !agent.proposal) {
      return;
    }
    update(id, { pending: decision, decisionError: undefined });
    try {
      const state = await decidePurchase(id, { decision, decidedBy: agent.buyer?.email });
      update(id, { agent: state, pending: undefined });
      // An older in-flight response must not replace the accepted decision
      if (id === params.id) {
        restartPolling?.();
      }
    } catch (err) {
      update(id, { pending: undefined, decisionError: describe(err) });
    }
  }
</script>

<svelte:head>
  <title>Shopping agent · Durable agentic commerce</title>
</svelte:head>

<AgentLifecycle agent={current.agent} />

<main>
  <AgentPanel
    agentId={params.id}
    agent={current.agent}
    error={current.error}
    notFound={current.notFound}
    pending={current.pending}
    decisionError={current.decisionError}
    ondecide={decide}
  />
  {#if !current.notFound}
    <HandoffPanel agent={current.agent} />
  {/if}
</main>

<style>
  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 1.25rem;
    align-items: start;
  }

  @media (max-width: 1100px) {
    main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
