import { collectDefaultMetrics, Histogram, Registry } from '@prometheus-io/client';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration = new Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Duration of the HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
