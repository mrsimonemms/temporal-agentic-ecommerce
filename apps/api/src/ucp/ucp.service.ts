import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UcpDiscoveryProfile } from '@ucp-js/sdk';

@Injectable()
export class UcpService {
  constructor(private readonly config: ConfigService) {}

  getMerchantProfile(): UcpDiscoveryProfile {
    return this.config.getOrThrow<UcpDiscoveryProfile>('ucp');
  }
}
