import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientOptions, Connection, ConnectionOptions } from '@temporalio/client';

import { ITemporalConfig } from '../config/temporal';

export const CONNECTION = Symbol('CONNECTION');
export const WORKFLOW_CLIENT = Symbol('WORKFLOW_CLIENT');

export const temporalProviders: Provider[] = [
  {
    inject: [ConfigService],
    provide: CONNECTION,
    useFactory(cfg: ConfigService): Promise<Connection> {
      return Connection.connect(cfg.getOrThrow<ConnectionOptions>('temporal.connection'));
    },
  },
  {
    inject: [CONNECTION, ConfigService],
    provide: WORKFLOW_CLIENT,
    useFactory: (connection: Connection, cfg: ConfigService): Client => {
      const temporalConfig = cfg.getOrThrow<ITemporalConfig>('temporal');

      const clientOpts: ClientOptions = {
        connection,
        ...temporalConfig.client,
      };

      return new Client(clientOpts);
    },
  },
];
