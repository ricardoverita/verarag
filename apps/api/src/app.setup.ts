import { StandardSchemaSerializerInterceptor, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { validationPipe } from './common/validation.js';
import { CONFIG, type Config } from './config/config.js';
import { httpMetricsMiddleware } from './observability/http-metrics.middleware.js';
import { httpTracingMiddleware } from './observability/http-tracing.middleware.js';
import { MetricsService } from './observability/metrics.service.js';
import { OPERATIONAL_ROUTES } from './routes.js';

/** HTTP setup shared by main.ts and the HTTP tests. */
export function configureApp(app: NestExpressApplication): void {
  app.set('trust proxy', app.get<Config>(CONFIG).http.trustProxy);
  app.use(httpMetricsMiddleware(app.get(MetricsService)));
  app.use(helmet());
  // Responses carry user and organization data: never cache them.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Nothing the API accepts today comes close to this size.
  app.useBodyParser('json', { limit: '16kb' });
  app.use(httpTracingMiddleware());
  app.setGlobalPrefix('api', { exclude: [...OPERATIONAL_ROUTES] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(validationPipe());
  // Applies the response schemas declared with @ResponseSchema.
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));
  app.enableShutdownHooks();
}
