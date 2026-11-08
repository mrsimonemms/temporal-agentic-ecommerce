<script lang="ts">
  import { resolve } from '$app/paths';

  import favicon from '$lib/assets/favicon.svg';

  import '../app.css';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="dashboard">
  <header>
    <div class="brand">
      <!-- Always returns to a fresh dashboard. Workflows already started keep running. -->
      <a href={resolve('/')} class="logo" aria-label="Start again">
        <img src="/img/logo.png" alt="" width="24" height="24" />
      </a>
      <div>
        <h1>Durable agentic commerce</h1>
        <p>
          An AI agent decides what to buy. Temporal makes sure the purchase, and the Order behind
          it, are carried through.
        </p>
      </div>
    </div>
    <p class="tagline">Agents can buy. Can your systems deliver?</p>
  </header>

  {@render children()}
</div>

<style>
  .dashboard {
    max-width: 120rem;
    min-height: 100vh;
    margin: 0 auto;
    padding: 1rem 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .logo {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 0.6rem;
    background: var(--text);
  }

  .logo:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  h1 {
    font-size: 1.9rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .brand p {
    color: var(--muted);
  }

  .tagline {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--accent);
  }
</style>
