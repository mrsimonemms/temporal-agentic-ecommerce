import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';

// UCP Idempotency-Key handling for the checkout REST binding. When a key is
// provided, a retried request with the same body returns the original outcome
// and a reused key with a different body is rejected with HTTP 409.
// @link https://ucp.dev/2026-08-25/specification/shopping/checkout/rest/

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

const MAX_KEY_LENGTH = 255;

export interface IdempotentRequest {
  key: string;
  // Fingerprint of the validated request body
  hash: string;
}

// Serialises with sorted object keys so equivalent bodies hash identically
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

// Returns undefined when no key was sent, so requests without a key behave as
// before. A key that is sent must be usable.
export function idempotentRequest(
  key: string | undefined,
  body: unknown,
): IdempotentRequest | undefined {
  if (key === undefined) {
    return undefined;
  }
  if (key.trim() === '' || key.length > MAX_KEY_LENGTH) {
    throw new BadRequestException({
      code: 'invalid_request',
      content: `Idempotency-Key must be between 1 and ${MAX_KEY_LENGTH} characters`,
    });
  }

  return { key, hash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
}

export function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: 'idempotency_key_reused',
    content: 'The Idempotency-Key was already used with a different request',
  });
}

// MongoDB duplicate key error, raised by the unique idempotency indexes
export function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && err.code === 11000;
}
