<script lang="ts">
  import type { CheckoutCreateRequest } from '@ucp-js/sdk';

  import { CATALOGUE } from '$lib/catalogue';
  import { checkoutRequest } from '$lib/ucp';

  const MAX_QUANTITY = 9;

  let {
    busy = false,
    oncreate,
  }: { busy?: boolean; oncreate: (request: CheckoutCreateRequest) => void } = $props();

  // Prefilled so a checkout can be created in one click during a demo
  let quantities = $state<Record<string, number>>({ sku_kettle: 1, sku_mug_set: 2 });
  let name = $state('Jane Doe');
  let email = $state('jane@example.com');

  let itemCount = $derived(Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0));

  function adjust(id: string, delta: number) {
    quantities[id] = Math.min(MAX_QUANTITY, Math.max(0, (quantities[id] ?? 0) + delta));
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();

    oncreate(checkoutRequest(quantities, { email, name }));
  }
</script>

<form class="panel" onsubmit={submit} aria-labelledby="manual-checkout-heading">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Manual purchase</p>
      <h2 id="manual-checkout-heading">Or buy manually</h2>
    </div>
  </div>

  <p class="explainer">
    Buy directly without using AI. The purchase creates the same durable Order, with the same
    fulfilment and recovery capabilities.
  </p>

  <fieldset>
    <legend class="eyebrow">Products</legend>
    <ul class="products">
      {#each CATALOGUE as item (item.id)}
        {@const quantity = quantities[item.id] ?? 0}
        <li class={{ selected: quantity > 0 }}>
          <span class="title">{item.title}</span>
          <div class="stepper">
            <button
              type="button"
              onclick={() => adjust(item.id, -1)}
              disabled={busy || quantity === 0}
              aria-label="Decrease quantity of {item.title}">−</button
            >
            <output aria-live="polite" aria-label="Quantity of {item.title}">{quantity}</output>
            <button
              type="button"
              onclick={() => adjust(item.id, 1)}
              disabled={busy || quantity === MAX_QUANTITY}
              aria-label="Increase quantity of {item.title}">+</button
            >
          </div>
        </li>
      {/each}
    </ul>
  </fieldset>

  <fieldset class="buyer">
    <legend class="eyebrow">Buyer</legend>
    <!-- One field, so names are entered as written rather than split into parts -->
    <label>
      Name
      <input type="text" bind:value={name} autocomplete="off" disabled={busy} />
    </label>
    <label>
      Email
      <input type="email" bind:value={email} required autocomplete="off" disabled={busy} />
    </label>
  </fieldset>

  <div class="actions">
    <p class="hint">
      {itemCount}
      {itemCount === 1 ? 'item' : 'items'} · prices are set by the commerce API
    </p>
    <button type="submit" class="button primary" disabled={busy || itemCount === 0}>
      {busy ? 'Creating…' : 'Create checkout'}
    </button>
  </div>
</form>

<style>
  fieldset {
    border: none;
    margin: 0;
    padding: 0;
    /* Browsers default fieldsets to min-content, preventing them shrinking to the panel */
    min-inline-size: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 0.6rem;
  }

  .products {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .products li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .products li.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .title {
    font-weight: 600;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .stepper button {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: var(--surface);
    font: inherit;
    font-size: 1.2rem;
    line-height: 1;
    cursor: pointer;
  }

  .stepper button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .stepper output {
    min-width: 2rem;
    text-align: center;
    font-size: 1.2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /*
   * Name and email sit side by side when there is room and stack otherwise,
   * matching the agent form. min() lets a track shrink below the inputs'
   * intrinsic width on the narrowest screens.
   */
  .buyer {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: 0.75rem;
  }

  .buyer legend {
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

  input {
    font: inherit;
    font-weight: 400;
    color: var(--text);
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  input:focus-visible {
    outline: 3px solid var(--accent-soft);
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .explainer,
  .hint {
    color: var(--muted);
  }

  .hint {
    font-size: 0.9rem;
  }
</style>
