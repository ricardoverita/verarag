import { Gauge } from '@prometheus-io/client';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DocumentStatus } from '@verarag/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { Database } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import { DocumentsRepository } from './documents.repository.js';

const STATUSES: DocumentStatus[] = ['UPLOADING', 'AVAILABLE', 'FAILED', 'DELETING'];

@Injectable()
export class DocumentsMetrics implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly db: Database,
    private readonly documents: DocumentsRepository,
    @InjectPinoLogger(DocumentsMetrics.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    // Read from PostgreSQL on every scrape. Documents that stay UPLOADING or
    // DELETING for long are the ones a recovery task will have to look at.
    const documents: Gauge<'status'> = new Gauge({
      name: 'verarag_documents',
      help: 'Documents that are not deleted, by storage status.',
      labelNames: ['status'] as const,
      registers: [this.metrics.registry],
      collect: async () => {
        try {
          const counts = await this.documents.countByStatus(this.db);
          for (const status of STATUSES) {
            documents.set({ status }, counts.get(status) ?? 0);
          }
        } catch (error) {
          this.logger.debug({ err: error }, 'could not count documents');
        }
      },
    });
  }
}
