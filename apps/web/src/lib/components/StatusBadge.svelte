<script lang="ts">
  import type { StatusDisplay } from '$lib/format';

  let { status, large = false }: { status: StatusDisplay; large?: boolean } = $props();
</script>

<span class={['badge', status.tone, { large }]}>{status.label}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    border-radius: 999px;
    padding: 0.3em 0.8em;
    font-size: 0.9rem;
    font-weight: 650;
    white-space: nowrap;
  }

  .badge::before {
    content: '';
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: currentColor;
  }

  .large {
    font-size: 1.15rem;
  }

  .neutral {
    color: var(--neutral);
    background: var(--neutral-soft);
  }

  .info {
    color: var(--info);
    background: var(--info-soft);
  }

  .success {
    color: var(--success);
    background: var(--success-soft);
  }

  .warning {
    color: var(--warning);
    background: var(--warning-soft);
  }

  .danger {
    color: var(--danger);
    background: var(--danger-soft);
  }
</style>
