<script lang="ts">
  import { failuresLabel } from '$lib/format';

  // Demo only: how many inventory reservation attempts fail before succeeding
  const CHOICES = [0, 1, 2];

  let {
    selected,
    disabled = false,
    onselect,
  }: {
    selected?: number;
    disabled?: boolean;
    onselect: (failures: number) => void;
  } = $props();
</script>

<div class="choices" role="group" aria-label="Simulated inventory failures">
  {#each CHOICES as failures (failures)}
    <button
      type="button"
      class={['choice', { selected: selected === failures }]}
      aria-pressed={selected === failures}
      {disabled}
      onclick={() => failures !== selected && onselect(failures)}
    >
      {failuresLabel(failures)}
    </button>
  {/each}
</div>

<style>
  .choices {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .choice {
    font: inherit;
    font-weight: 600;
    padding: 0.6rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .choice.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .choice:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
