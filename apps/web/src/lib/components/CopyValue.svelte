<script lang="ts">
  let { label, value }: { label: string; value: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused, leaving the value visible to select
      return;
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="copy-value">
  <span class="eyebrow">{label}</span>
  <div class="row">
    <code>{value}</code>
    <button type="button" class="copy" onclick={copy} aria-label="Copy {label}">
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>
</div>

<style>
  .copy-value {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  code {
    font-size: 1rem;
    overflow-wrap: anywhere;
  }

  .copy {
    flex-shrink: 0;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-soft);
    border: none;
    border-radius: 0.375rem;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
  }
</style>
