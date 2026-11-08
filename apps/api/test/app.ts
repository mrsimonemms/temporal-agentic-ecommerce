import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';

import { configureApp } from '../src/app.setup';
import { CheckoutModule } from '../src/checkout/checkout.module';
import { Checkout } from '../src/checkout/checkout.schema';
import ucp from '../src/config/ucp';
import { DemoModule } from '../src/demo/demo.module';
import { HealthModule } from '../src/health/health.module';
import { OrderModule } from '../src/order/order.module';
import { ShoppingAgentModule } from '../src/shopping-agent/shopping-agent.module';
import { CONNECTION, WORKFLOW_CLIENT } from '../src/temporal/temporal.providers';
import { TemporalService } from '../src/temporal/temporal.service';
import { UcpModule } from '../src/ucp/ucp.module';
import { FakeCheckoutModel, FakeTemporalService } from './fakes';

export interface TestApp {
  app: NestFastifyApplication;
  model: FakeCheckoutModel;
  temporal: FakeTemporalService;
}

// Builds the API from its real feature modules, configured as in main.ts, with
// only MongoDB, Temporal and the health indicators replaced by fakes
export async function createTestApp(): Promise<TestApp> {
  vi.stubEnv('SCHEMA_URL', 'http://localhost:9999');

  const model = new FakeCheckoutModel();
  const temporal = new FakeTemporalService();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [ucp] }),
      HealthModule,
      UcpModule,
      CheckoutModule,
      OrderModule,
      DemoModule,
      ShoppingAgentModule,
    ],
  })
    .overrideProvider(getModelToken(Checkout.name))
    .useValue(model)
    .overrideProvider(CONNECTION)
    .useValue({})
    .overrideProvider(WORKFLOW_CLIENT)
    .useValue({})
    .overrideProvider(TemporalService)
    .useValue(temporal)
    .overrideProvider(HealthCheckService)
    .useValue({ check: async () => ({ status: 'ok', info: {}, error: {}, details: {} }) })
    .overrideProvider(MongooseHealthIndicator)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, model, temporal };
}

export async function closeTestApp({ app }: TestApp): Promise<void> {
  await app.close();
  vi.unstubAllEnvs();
}
