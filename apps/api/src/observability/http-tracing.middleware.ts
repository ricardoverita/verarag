import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

import { isOperationalPath } from '../routes.js';
import { routeLabel } from './http-metrics.middleware.js';
import { tracer } from './tracing.service.js';

/**
 * Opens a server span per request, continuing the trace from an incoming
 * `traceparent` header, and makes it the active context so spans created
 * while handling the request (like publishing an event) become children.
 *
 * It must run after the body parser: parsing finishes in a stream callback
 * that would lose the active context.
 */
export function httpTracingMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isOperationalPath(req.url)) {
      next();
      return;
    }

    const parent = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(
      req.method,
      { kind: SpanKind.SERVER, attributes: { 'http.request.method': req.method } },
      parent,
    );

    res.on('finish', () => {
      const route = routeLabel(req);
      span.updateName(`${req.method} ${route}`);
      span.setAttributes({ 'http.route': route, 'http.response.status_code': res.statusCode });
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    });

    context.with(trace.setSpan(parent, span), next);
  };
}
