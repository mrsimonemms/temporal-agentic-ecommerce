<script lang="ts">
  import type { CheckoutCreateRequest } from '@ucp-js/sdk';

  import { CATALOGUE } from '$lib/catalogue';

  const MAX_QUANTITY = 9;

  let {
    busy = false,
    oncreate,
  }: { busy?: boolean; oncreate: (request: CheckoutCreateRequest) => void } = $props();

  // Prefilled so a checkout can be created in one click during a demo
  let quantities = $state<Record<string, number>>({ sku_kettle: 1, sku_mug_set: 2 });
  let email = $state('jane@example.com');
  let firstName = $state('Jane');
  let lastName = $state('Doe');

  let itemCount = $derived(Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0));

  function adjust(id: string, delta: number) {
    quantities[id] = Math.min(MAX_QUANTITY, Math.max(0, (quantities[id] ?? 0) + delta));
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();

    oncreate({
      line_items: CATALOGUE.filter((item) => (quantities[item.id] ?? 0) > 0).map((item) => ({
        item: { id: item.id },
        quantity: quantities[item.id],
      })),
      buyer: {
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      },
    });
  }
</script>

<form class="panel" onsubmit={submit}>
  <div class="panel-header">
    <div>
      <p class="eyebrow">UCP checkout</p>
      <h2>New checkout</h2>
    </div>
  </div>

  <fieldset>
    <legend class="eyebrow">Products</legend>
    <ul class="products">
      {#each CATALOGUE as item (item.id)}
        {@const quantity = quantities[item.id] ?? 0}
        <li class={{ selected: quantity > 0 }}>
          <div>
            <span class="title">{item.title}</span>
            <span class="sku mono">{item.id}</span>
          </div>
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
    <label class="email">
      Email
      <input type="email" bind:value={email} required autocomplete="off" disabled={busy} />
    </label>
    <label>
      First name
      <input type="text" bind:value={firstName} autocomplete="off" disabled={busy} />
    </label>
    <label>
      Last name
      <input type="text" bind:value={lastName} autocomplete="off" disabled={busy} />
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
    display: block;
    font-weight: 600;
  }

  .sku {
    color: var(--muted);
    font-size: 0.8rem;
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

  .buyer {
    display: grid;
    /* A bare 1fr track cannot shrink below the inputs' intrinsic width */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .buyer legend {
    grid-column: 1 / -1;
  }

  .email {
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

  .hint {
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
