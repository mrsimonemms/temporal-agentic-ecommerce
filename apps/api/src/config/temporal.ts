import { registerAs } from '@nestjs/config';
import { ClientOptions, ConnectionOptions } from '@temporalio/client';

export interface ITemporalConfig {
  client: Omit<ClientOptions, 'connection'>;
  connection: ConnectionOptions;
}

export default registerAs('temporal', (): ITemporalConfig => ({
  connection: {
    address: process.env.TEMPORAL_ADDRESS,
    apiKey: process.env.TEMPORAL_KEY,
    connectTimeout: process.env.TEMPORAL_CONNECTION_TIMEOUT,
    tls: process.env.TEMPORAL_TLS === 'true',
    metadata: {
      'temporal-namespace': process.env.TEMPORAL_NAMESPACE ?? 'default',
    },
  },
  client: {},
}));
