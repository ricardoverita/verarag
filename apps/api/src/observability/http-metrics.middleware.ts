import type { NextFunction, Request, Response } from 'express';

import type { MetricsService } from './metrics.service.js';

/**
 * Records the duration of every HTTP request. It is registered directly on
 * Express so it also sees requests that do not match any route.
 */
export function httpMetricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const stopTimer = metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
      stopTimer({ method: req.method, route: routeLabel(req), status_code: res.statusCode });
    });
    next();
  };
}

/**
 * Uses the route pattern instead of the raw URL so ids in paths do not create
 * a new time series per request.
 */
export function routeLabel(req: Request): string {
  const route: unknown = req.route;
  if (typeof route === 'object' && route !== null && 'path' in route) {
    return `${req.baseUrl}${String(route.path)}`;
  }
  return 'unmatched';
}
