import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import loggerConfig from './config/logger';

const logger = new Logger('bootstrap');

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: new ConsoleLogger(loggerConfig()),
  });

  const config = app.get(ConfigService);

  configureApp(app);

  await app.listen(config.getOrThrow<number>('server.port'), config.getOrThrow('server.host'));
}

bootstrap().catch((err: Error) => {
  logger.fatal(err.stack);
});
