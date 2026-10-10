import { Gauge } from '@prometheus-io/client';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { Database } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import { CollectionsRepository } from './collections.repository.js';

@Injectable()
export class CollectionsMetrics implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly db: Database,
    private readonly collections: CollectionsRepository,
    @InjectPinoLogger(CollectionsMetrics.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    // A gauge read from PostgreSQL on every scrape, without per-organization labels.
    const collections: Gauge = new Gauge({
      name: 'verarag_collections',
      help: 'Collections that exist, without deleted ones.',
      registers: [this.metrics.registry],
      collect: async () => {
        try {
          collections.set(await this.collections.count(this.db));
        } catch (error) {
          this.logger.debug({ err: error }, 'could not count collections');
        }
      },
    });
  }
}
