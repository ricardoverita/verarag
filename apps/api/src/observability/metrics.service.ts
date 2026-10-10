import { collectDefaultMetrics, Counter, Histogram, Registry } from '@prometheus-io/client';
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

  readonly eventsPublished = new Counter({
    name: 'verarag_events_published_total',
    help: 'Events the API tried to publish to NATS, by event type and outcome.',
    labelNames: ['type', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly logins = new Counter({
    name: 'verarag_auth_login_total',
    help: 'Successful sign-ins.',
    registers: [this.registry],
  });

  readonly loginFailures = new Counter({
    name: 'verarag_auth_login_failed_total',
    help: 'Rejected sign-ins, by reason (invalid_credentials or too_many_attempts).',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly invitationsCreated = new Counter({
    name: 'verarag_invitations_created_total',
    help: 'Invitations created.',
    registers: [this.registry],
  });

  readonly invitationsAccepted = new Counter({
    name: 'verarag_invitations_accepted_total',
    help: 'Invitations accepted, by existing or new users (account: existing or new).',
    labelNames: ['account'] as const,
    registers: [this.registry],
  });

  readonly apiKeysCreated = new Counter({
    name: 'verarag_api_keys_created_total',
    help: 'API keys created.',
    registers: [this.registry],
  });

  readonly apiKeysRejected = new Counter({
    name: 'verarag_auth_api_key_rejected_total',
    help: 'Requests with an API key that was refused, by reason (invalid, revoked, expired or insufficient_scope).',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly storageOperationDuration = new Histogram({
    name: 'verarag_storage_operation_duration_seconds',
    help: 'Duration of object storage calls, by operation (put, get, head, delete) and outcome.',
    labelNames: ['operation', 'outcome'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
