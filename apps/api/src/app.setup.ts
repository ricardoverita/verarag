import { StandardSchemaValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { httpMetricsMiddleware } from './observability/http-metrics.middleware.js';
import { httpTracingMiddleware } from './observability/http-tracing.middleware.js';
import { MetricsService } from './observability/metrics.service.js';
import { OPERATIONAL_ROUTES } from './routes.js';

/** HTTP setup shared by main.ts and the HTTP tests. */
export function configureApp(app: NestExpressApplication): void {
  app.use(httpMetricsMiddleware(app.get(MetricsService)));
  app.use(helmet());
  // Nothing the API accepts today comes close to this size.
  app.useBodyParser('json', { limit: '16kb' });
  app.use(httpTracingMiddleware());
  app.setGlobalPrefix('api', { exclude: [...OPERATIONAL_ROUTES] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Validates parameters declared with a schema, e.g. @Body({ schema }).
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();
}
