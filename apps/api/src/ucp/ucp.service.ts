import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ErrorResponse, type MessageError, type UcpProfileDocument } from '@ucp-js/sdk';

// Protocol-level helpers shared by the UCP capabilities
@Injectable()
export class UcpService {
  constructor(private readonly config: ConfigService) {}

  // The configured profile follows the 2026-08-25 profile document shape
  profile(): UcpProfileDocument {
    return this.config.getOrThrow<UcpProfileDocument>('ucp');
  }

  version(): string {
    return this.profile().ucp.version;
  }

  notFound(resource: string, id: string): ErrorResponse {
    return this.errorResponse([
      {
        type: 'error',
        code: 'not_found',
        content: `${resource} "${id}" was not found`,
        severity: 'unrecoverable',
      },
    ]);
  }

  // Business outcome where no resource exists to return
  errorResponse(messages: MessageError[]): ErrorResponse {
    return {
      ucp: { version: this.version(), status: 'error' },
      messages,
    };
  }
}
