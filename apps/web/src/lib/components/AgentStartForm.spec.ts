import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { text } from '../testing/text';
import AgentStartForm from './AgentStartForm.svelte';

const onstart = () => {};

describe('AgentStartForm', () => {
  it('is prefilled with the demo request and buyer', () => {
    const { body } = render(AgentStartForm, { props: { onstart } });

    expect(body).toContain('Buy me a kettle and two sets of mugs. Keep it under £100.');
    expect(body).toContain('value="Jane Doe"');
    expect(body).toContain('value="jane@example.com"');
  });

  it('offers zero, one or two simulated inventory failures, defaulting to none', () => {
    const { body } = render(AgentStartForm, { props: { onstart } });
    const choices = [...body.matchAll(/<button[^>]*aria-pressed="(\w+)"[^>]*>([^<]+)</g)].map(
      ([, pressed, label]) => `${label.trim()}: ${pressed}`,
    );

    expect(choices).toEqual(['None: true', '1 failure: false', '2 failures: false']);
    expect(text(body)).toContain('Not part of the purchase');
  });

  it('starts the agent from a single button', () => {
    const { body } = render(AgentStartForm, { props: { onstart } });

    expect(body).toMatch(/<button[^>]*type="submit"[^>]*>\s*Start shopping agent\s*</);
  });

  it('disables the form while a request is in progress', () => {
    const { body } = render(AgentStartForm, { props: { onstart, busy: true, pending: true } });

    expect(text(body)).toContain('Starting…');
    expect(body).toMatch(/<textarea[^>]*disabled/);
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it('shows why the agent did not start', () => {
    const content = text(
      render(AgentStartForm, {
        props: { onstart, error: 'The commerce API could not be reached' },
      }).body,
    );

    expect(content).toContain('The shopping agent did not start');
    expect(content).toContain('The commerce API could not be reached');
  });
});
