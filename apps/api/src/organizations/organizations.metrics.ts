import { Gauge } from '@prometheus-io/client';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { Database } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import { OrganizationsRepository } from './organizations.repository.js';

@Injectable()
export class OrganizationsMetrics implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly db: Database,
    private readonly organizations: OrganizationsRepository,
    @InjectPinoLogger(OrganizationsMetrics.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    // A gauge read from PostgreSQL on every scrape, without per-organization labels.
    const organizations: Gauge = new Gauge({
      name: 'verarag_organizations',
      help: 'Organizations that exist.',
      registers: [this.metrics.registry],
      collect: async () => {
        try {
          organizations.set(await this.organizations.count(this.db));
        } catch (error) {
          this.logger.debug({ err: error }, 'could not count organizations');
        }
      },
    });
  }
}
