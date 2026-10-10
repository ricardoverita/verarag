import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { validationPipe } from './common/validation.js';
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
  app.useGlobalPipes(validationPipe());
  app.enableShutdownHooks();
}
