<script lang="ts">
  import type { AgentState } from '$lib/agent';

  let { agent }: { agent?: AgentState } = $props();

  type StepState = 'done' | 'active' | 'pending' | 'skipped' | 'failed';

  interface Step {
    label: string;
    detail: string;
    state: StepState;
  }

  const AGENT_STEPS = [
    { label: 'Planning', detail: 'AI selects products' },
    { label: 'Proposal ready', detail: 'Validated by the worker' },
    { label: 'Awaiting approval', detail: 'Human decision' },
    { label: 'Purchasing', detail: 'Checkout, retried by Temporal' },
    { label: 'Purchased', detail: 'Agent finished' },
  ];

  const PURCHASING = 3;

  // Each step is only shown as reached once the API has reported it
  let agentSteps = $derived.by((): Step[] => {
    const status = agent?.status;
    // Index of the step in progress, or of the step that ended the agent
    let current: number;
    let outcome: 'running' | 'purchased' | 'rejected' | 'failed' = 'running';

    switch (status) {
      case undefined:
        current = -1;
        break;
      case 'planning':
        current = 0;
        break;
      case 'awaiting_approval':
        current = 2;
        break;
      case 'approved':
      case 'purchasing':
        current = PURCHASING;
        break;
      case 'purchased':
        current = AGENT_STEPS.length - 1;
        outcome = 'purchased';
        break;
      case 'rejected':
        current = 2;
        outcome = 'rejected';
        break;
      case 'failed':
        current = agent?.decision?.decision === 'approve' ? PURCHASING : 0;
        outcome = 'failed';
        break;
    }

    return AGENT_STEPS.map((step, index): Step => {
      if (index < current || (index === current && outcome !== 'running' && outcome !== 'failed')) {
        const detail = index === 2 && outcome === 'rejected' ? 'Rejected' : step.detail;
        return { ...step, detail, state: 'done' };
      }
      if (index === current) {
        return outcome === 'failed'
          ? { ...step, detail: 'Failed', state: 'failed' }
          : { ...step, state: 'active' };
      }
      return {
        ...step,
        state: outcome === 'running' || outcome === 'purchased' ? 'pending' : 'skipped',
      };
    });
  });

  // The Order is a separate Workflow: the agent only hands over to it
  let orderStep = $derived.by((): Step => {
    if (agent?.orderId) {
      return { label: 'Order placed', detail: 'Continues independently', state: 'done' };
    }
    const ended = agent?.status === 'rejected' || agent?.status === 'failed';
    return {
      label: 'Order placed',
      detail: 'Starts at checkout',
      state: ended ? 'skipped' : 'pending',
    };
  });
</script>

{#snippet stage(step: Step, number: number)}
  <li class={step.state} aria-current={step.state === 'active' ? 'step' : undefined}>
    <span class="marker" aria-hidden="true">
      {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : number}
    </span>
    <span class="text">
      <span class="label">{step.label}</span>
      <span class="detail">{step.state === 'skipped' ? 'Not needed' : step.detail}</span>
    </span>
  </li>
{/snippet}

<nav class="lifecycle" aria-label="Shopping agent lifecycle">
  <div class="stages">
    <div class="group agent">
      <div class="heading">
        <span class="eyebrow">Shopping agent · durable Temporal Workflow</span>
      </div>
      <ol>
        {#each agentSteps as step, index (index)}
          {@render stage(step, index + 1)}
        {/each}
      </ol>
    </div>
    <div class="group order">
      <div class="heading"><span class="eyebrow">Order · its own Workflow</span></div>
      <ol start={AGENT_STEPS.length + 1}>
        {@render stage(orderStep, AGENT_STEPS.length + 1)}
      </ol>
    </div>
  </div>
</nav>

<style>
  /* Matches Lifecycle: the panel is a size container so the layout responds
   * to the width available to the stages */
  .lifecycle {
    container: agent-lifecycle / inline-size;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1.5rem 1rem;
  }

  .stages {
    display: grid;
    grid-template-columns: 5fr 1fr;
    column-gap: 0.75rem;
    row-gap: 0.6rem;
  }

  .group {
    display: contents;
  }

  .heading {
    grid-row: 1;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--accent);
  }

  .agent .eyebrow {
    color: var(--accent);
  }

  .order .heading {
    border-bottom-color: var(--border);
  }

  /* Both lists share six columns so the hand-off sits after the agent's stages */
  ol {
    grid-row: 2;
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .order li {
    grid-column: 6;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--muted);
  }

  .marker {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    font-weight: 700;
    font-size: 0.9rem;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .label {
    font-weight: 650;
    font-size: 0.95rem;
    line-height: 1.25;
  }

  .detail {
    font-size: 0.8rem;
  }

  li.active,
  li.done,
  li.failed {
    color: var(--text);
  }

  li.active .marker {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }

  li.done .marker {
    border-color: var(--success);
    background: var(--success);
    color: #fff;
  }

  li.failed .marker {
    border-color: var(--danger);
    background: var(--danger);
    color: #fff;
  }

  li.failed .detail {
    color: var(--danger);
    font-weight: 600;
  }

  li.skipped {
    opacity: 0.55;
  }

  li.skipped .marker {
    border-style: dashed;
  }

  @media (max-width: 768px) {
    .lifecycle {
      padding: 1rem;
    }
  }

  /* Below a single row, each group takes its own row in three columns, then
   * stacks vertically on narrow screens */
  @container agent-lifecycle (width < 60rem) {
    .stages {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 1.25rem;
    }

    .group {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    ol {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1rem 0.75rem;
      padding-left: 0.25rem;
    }

    .order li {
      grid-column: auto;
    }

    li {
      align-items: flex-start;
    }

    .text {
      padding-top: 0.15rem;
    }
  }

  @container agent-lifecycle (width < 36rem) {
    ol {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.6rem;
    }
  }
</style>
