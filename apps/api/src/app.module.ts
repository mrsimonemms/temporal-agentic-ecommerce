import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';

import { CheckoutModule } from './checkout/checkout.module';
import config from './config';
import { DemoModule } from './demo/demo.module';
import { HealthModule } from './health/health.module';
import { OrderModule } from './order/order.module';
import { ShoppingAgentModule } from './shopping-agent/shopping-agent.module';
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
    CheckoutModule,
    OrderModule,
    DemoModule,
    ShoppingAgentModule,
  ],
})
export class AppModule {}
