<script lang="ts">
  import { resolve } from '$app/paths';

  import { type AgentState, type PurchaseDecision, scenarioLabel } from '$lib/agent';
  import { agentStatus, formatAmount, formatTime } from '$lib/format';

  import LineItems from './LineItems.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let {
    agentId,
    agent,
    error,
    notFound = false,
    pending,
    decisionError,
    ondecide,
  }: {
    agentId: string;
    agent?: AgentState;
    // Latest polling failure, shown alongside the last known state
    error?: string;
    notFound?: boolean;
    // Decision being submitted
    pending?: PurchaseDecision;
    decisionError?: string;
    ondecide: (decision: PurchaseDecision) => void;
  } = $props();

  let proposal = $derived(agent?.proposal);

  let rows = $derived(
    proposal?.lines.map((line) => ({
      id: line.productId,
      title: line.title,
      sku: line.productId,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      total: line.total,
    })) ?? [],
  );

  let simulatedOutage = $derived(agent?.demo?.scenario === 'ai_service_unavailable');

  // Only a validated proposal awaiting a decision can be approved
  let canDecide = $derived(agent?.status === 'awaiting_approval' && !!proposal);
</script>

<section class="panel" aria-labelledby="agent-heading" aria-busy={!agent && !notFound}>
  <div class="panel-header">
    <div>
      <p class="eyebrow">AI shopping agent · OpenAI function calling</p>
      <h2 id="agent-heading">Shopping agent</h2>
    </div>
    {#if agent}
      <StatusBadge status={agentStatus(agent.status)} large />
    {/if}
  </div>

  {#if notFound}
    <div class="empty">
      <p class="empty-title">Shopping agent not found</p>
      <p>No shopping agent exists with this ID.</p>
      <p class="mono">{agentId}</p>
      <a class="button secondary" href={resolve('/')}>Start a new request</a>
    </div>
  {:else if !agent}
    <div class="empty">
      {#if error}
        <p class="empty-title">Unable to load the shopping agent</p>
        <p>{error}. Retrying.</p>
      {:else}
        <p class="empty-title">Loading shopping agent…</p>
      {/if}
      <p class="mono">{agentId}</p>
    </div>
  {:else}
    {#if agent.request}
      <figure class="request">
        <blockquote>{agent.request}</blockquote>
        {#if agent.buyer}
          <figcaption>
            For {agent.buyer.name ? `${agent.buyer.name} · ` : ''}{agent.buyer.email}
          </figcaption>
        {/if}
      </figure>
    {/if}

    {#if agent.demo}
      <div class="demo-control">
        <div class="demo-heading">
          <span class="eyebrow">Demo only · AI failure scenario</span>
          <span class="configured">{scenarioLabel(agent.demo.scenario)}</span>
        </div>
        <p class="hint">Affects this Shopping Agent only, not the Order it places.</p>
      </div>
    {/if}

    {#if error}
      <div class="notice warning" role="status">
        <strong>Connection interrupted, retrying</strong>
        <p>{error}. Showing the last known state. The agent itself continues in Temporal.</p>
      </div>
    {:else if agent.status === 'planning' && simulatedOutage}
      <div class="notice info" role="status">
        <strong>Planning · AI service unavailable</strong>
        <p>
          The first five planning attempts fail with a simulated outage. Temporal is retrying the
          planning automatically, without repeating the catalogue retrieval it has already
          completed. No action is needed: the agent plans the purchase once the service responds.
        </p>
      </div>
    {:else if agent.status === 'planning'}
      <div class="notice info" role="status">
        <strong>Planning</strong>
        <p>
          The agent is reading the catalogue and choosing products with OpenAI. Each completed step
          is recorded by Temporal, so a failure does not repeat finished work.
        </p>
      </div>
    {:else if agent.status === 'awaiting_approval'}
      <div class="notice warning" role="status">
        <strong>Awaiting your approval</strong>
        <p>
          The proposal has been validated against the catalogue and budget. The Workflow waits
          durably for a decision: nothing is bought until a human approves.
        </p>
      </div>
    {:else if agent.status === 'approved' || agent.status === 'purchasing'}
      <div class="notice info" role="status">
        <strong>Purchasing</strong>
        <p>Approved. Temporal is completing the purchase through checkout.</p>
      </div>
    {:else if agent.status === 'purchased'}
      <div class="notice success" role="status">
        <strong>Purchased</strong>
        <p>The agent has finished. The approved proposal is kept below.</p>
      </div>
    {:else if agent.status === 'rejected'}
      <div class="notice neutral" role="status">
        <strong>Rejected</strong>
        <p>The proposal was rejected. Nothing was bought and the agent has finished.</p>
      </div>
    {:else if agent.status === 'failed'}
      <div class="notice danger" role="status">
        <strong>The agent could not complete the request</strong>
        <p>{agent.explanation ?? agent.error ?? 'The Shopping Agent Workflow failed.'}</p>
      </div>
    {/if}

    {#if proposal}
      <div class="proposal">
        <span class="eyebrow">Validated proposal</span>
        <LineItems {rows} currency={proposal.currency} total={proposal.total} />
        <p class="budget">
          Budget <strong>{formatAmount(proposal.budget, proposal.currency)}</strong>
          · {formatAmount(proposal.budget - proposal.total, proposal.currency)} to spare. Totals are calculated
          from catalogue prices, not by the model.
        </p>
      </div>
    {/if}

    {#if agent.decision}
      <p class="decision">
        {agent.decision.decision === 'approve' ? 'Approved' : 'Rejected'}
        {agent.decision.decidedBy ? `by ${agent.decision.decidedBy}` : ''}
        at {formatTime(agent.decision.decidedAt)}
      </p>
    {/if}

    {#if canDecide || pending}
      <div class="actions">
        <button
          type="button"
          class="button secondary"
          disabled={!!pending}
          onclick={() => ondecide('reject')}
        >
          {pending === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          class="button primary"
          disabled={!!pending}
          onclick={() => ondecide('approve')}
        >
          {pending === 'approve' ? 'Approving…' : 'Approve purchase'}
        </button>
      </div>
    {/if}

    {#if decisionError}
      <div class="notice danger" role="alert">
        <strong>Decision not accepted</strong>
        <p>{decisionError}</p>
      </div>
    {/if}
  {/if}
</section>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    color: var(--muted);
  }

  .empty-title {
    font-weight: 650;
    color: var(--text);
  }

  .request {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  blockquote {
    margin: 0;
    padding: 0.75rem 1rem;
    border-left: 4px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0.5rem;
    font-size: 1.2rem;
    font-weight: 600;
  }

  figcaption {
    font-size: 0.9rem;
    color: var(--muted);
  }

  .notice.neutral {
    color: var(--neutral);
    background: var(--neutral-soft);
  }

  .proposal {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .budget,
  .decision {
    font-size: 0.9rem;
    color: var(--muted);
  }

  .budget strong {
    color: var(--text);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
</style>
