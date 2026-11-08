import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { text } from '../testing/text';
import CheckoutForm from './CheckoutForm.svelte';

const oncreate = () => {};

describe('CheckoutForm', () => {
  it('presents the manual purchase in plain commerce terms', () => {
    const content = text(render(CheckoutForm, { props: { oncreate } }).body);

    expect(content).toContain('Manual purchase');
    expect(content).toContain('Or buy manually');
    expect(content).toContain(
      'Buy directly without using AI. The purchase creates the same durable Order, with the same fulfilment and recovery capabilities.',
    );
    expect(content).not.toContain('UCP');
  });

  it('asks for a single Name rather than first and last names', () => {
    const { body } = render(CheckoutForm, { props: { oncreate } });
    const labels = [...body.matchAll(/<label[^>]*>\s*([^<]+?)\s*<input/g)].map(([, l]) => l);

    expect(labels).toEqual(['Name', 'Email']);
    expect(body).toContain('value="Jane Doe"');
    expect(text(body)).not.toMatch(/First name|Last name/);
  });

  it('shows product titles without their IDs', () => {
    const content = text(render(CheckoutForm, { props: { oncreate } }).body);

    expect(content).toContain('Stainless Steel Kettle');
    expect(content).toContain('Stoneware Mug Set (4 pack)');
    expect(content).not.toContain('sku_');
  });
});
