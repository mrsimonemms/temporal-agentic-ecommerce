import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { setupSwagger } from './swagger';

// Application-wide configuration, shared by main.ts and the tests so routes
// are resolved exactly as in production
export function configureApp(app: INestApplication): void {
  app
    .enableShutdownHooks() // Required to close Temporal connection
    .enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    })
    .useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    .useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  setupSwagger(app);
}
