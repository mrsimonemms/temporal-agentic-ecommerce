<script lang="ts">
  import {
    type DemoScenario,
    SCENARIOS,
    type StartAgentRequest,
    startAgentRequest,
  } from '$lib/agent';

  import FailureChoices from './FailureChoices.svelte';

  // Matches the API's limit on the request
  const MAX_REQUEST_LENGTH = 1000;

  let {
    busy = false,
    pending = false,
    error,
    onstart,
  }: {
    busy?: boolean;
    // Set while this form's request is being submitted
    pending?: boolean;
    error?: string;
    onstart: (request: StartAgentRequest) => void;
  } = $props();

  // Prefilled so the demo starts with one click
  let request = $state('Buy me a kettle and two sets of mugs. Keep it under £100.');
  let name = $state('Jane Doe');
  let email = $state('jane@example.com');
  let scenario = $state<DemoScenario>('none');
  let inventoryFailures = $state(0);

  let canStart = $derived(request.trim() !== '' && email.trim() !== '');

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canStart) {
      return;
    }
    onstart(startAgentRequest({ request, name, email, scenario, inventoryFailures }));
  }
</script>

<form class="panel agent-form" onsubmit={submit} aria-labelledby="start-agent-heading">
  <div class="panel-header">
    <div>
      <p class="eyebrow accent">AI shopping agent</p>
      <h2 id="start-agent-heading">Ask the agent to buy</h2>
    </div>
  </div>

  <p class="explainer">
    The agent uses OpenAI with function calling to choose products from the catalogue. Its proposal
    is validated against real prices and your budget, then waits for your approval before anything
    is bought.
  </p>

  <label class="field">
    <span class="eyebrow">Shopping request</span>
    <textarea bind:value={request} rows="3" maxlength={MAX_REQUEST_LENGTH} disabled={busy} required
    ></textarea>
  </label>

  <fieldset class="buyer">
    <legend class="eyebrow">Buyer</legend>
    <label>
      <span>Name</span>
      <input type="text" bind:value={name} autocomplete="name" disabled={busy} />
    </label>
    <label>
      <span>Email</span>
      <input type="email" bind:value={email} autocomplete="email" disabled={busy} required />
    </label>
  </fieldset>

  <fieldset class="demo-control">
    <legend class="eyebrow">Demo only · AI failure scenario</legend>
    <div class="scenarios">
      {#each SCENARIOS as option (option.id)}
        <label class={['scenario', { selected: scenario === option.id }]}>
          <input
            type="radio"
            name="scenario"
            value={option.id}
            bind:group={scenario}
            disabled={busy}
          />
          <span class="scenario-text">
            <span class="scenario-label">{option.label}</span>
            <span class="scenario-description">{option.description}</span>
          </span>
        </label>
      {/each}
    </div>
    <p class="hint">
      Affects the Shopping Agent only. Temporal retries the failures automatically.
    </p>
  </fieldset>

  <div class="demo-control">
    <div class="demo-heading">
      <span class="eyebrow">Demo only · inventory failures</span>
    </div>
    <FailureChoices
      selected={inventoryFailures}
      disabled={busy}
      onselect={(failures) => (inventoryFailures = failures)}
    />
    <p class="hint">
      Affects the Order the agent places, not the agent. Applied before checkout completes and not
      part of the purchase.
    </p>
  </div>

  {#if error}
    <div class="notice danger" role="alert">
      <strong>The shopping agent did not start</strong>
      <p>{error}</p>
    </div>
  {/if}

  <div class="actions">
    <button type="submit" class="button primary" disabled={busy || !canStart}>
      {pending ? 'Starting…' : 'Start shopping agent'}
    </button>
  </div>
</form>

<style>
  .agent-form {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .eyebrow.accent {
    color: var(--accent);
  }

  .explainer {
    color: var(--muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  textarea,
  input {
    font: inherit;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text);
    width: 100%;
  }

  textarea {
    resize: vertical;
    font-size: 1.1rem;
  }

  textarea:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent-soft);
    border-color: var(--accent);
  }

  .buyer {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.75rem;
  }

  .buyer legend {
    margin-bottom: 0.4rem;
  }

  .buyer label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  /* Demo controls share the dashed box; the fieldset only adds its legend */
  fieldset.demo-control {
    margin: 0;
    min-width: 0;
  }

  /* A floated legend renders inside the box, like the other demo headings */
  fieldset.demo-control legend {
    float: left;
    width: 100%;
    padding: 0;
  }

  .scenarios {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    gap: 0.5rem;
  }

  /* Matches the inventory failure choices */
  .scenario {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    cursor: pointer;
  }

  .scenario.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .scenario input {
    width: auto;
    margin: 0.2rem 0 0;
    padding: 0;
    accent-color: var(--accent);
  }

  .scenario-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .scenario-label {
    font-weight: 600;
  }

  .scenario.selected .scenario-label {
    color: var(--accent);
  }

  .scenario-description {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
