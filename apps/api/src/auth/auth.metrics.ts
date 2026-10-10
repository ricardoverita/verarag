import { Gauge } from '@prometheus-io/client';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { Database } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import { SessionsRepository } from './sessions.repository.js';

/** Gauges read from PostgreSQL when Prometheus scrapes, so they are always current. */
@Injectable()
export class AuthMetrics implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly db: Database,
    private readonly sessions: SessionsRepository,
    @InjectPinoLogger(AuthMetrics.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    const activeSessions: Gauge = new Gauge({
      name: 'verarag_auth_active_sessions',
      help: 'Sessions that are neither expired nor revoked.',
      registers: [this.metrics.registry],
      collect: async () => {
        try {
          activeSessions.set(await this.sessions.countActive(this.db));
        } catch (error) {
          // Keep the last value: a scrape must not fail because the database is down.
          this.logger.debug({ err: error }, 'could not count active sessions');
        }
      },
    });
  }
}
