import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';

import config from './config';
import { HealthModule } from './health/health.module';
import { TemporalModule } from './temporal/temporal.module';
import { UcpModule } from './ucp/ucp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: config,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<MongooseModuleOptions>('db'),
    }),

    HealthModule,
    TemporalModule,
    UcpModule,
  ],
})
export class AppModule {}
