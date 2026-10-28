import { BadRequestException, PipeTransform } from '@nestjs/common';

// Structural subset of a Zod schema, satisfied by the @ucp-js/sdk schemas
interface UcpSchema<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
}

function toJsonPath(path: (string | number)[]): string {
  return path.reduce<string>(
    (acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : `${acc}.${key}`),
    '$',
  );
}

// Validates a request body against an official UCP schema. Malformed requests
// are protocol errors, so they are rejected with HTTP 400 and a code/content body.
export class UcpSchemaPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: UcpSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw new BadRequestException({
      code: 'invalid_request',
      content: result.error.issues
        .map((issue) => `${toJsonPath(issue.path)}: ${issue.message}`)
        .join('; '),
    });
  }
}
