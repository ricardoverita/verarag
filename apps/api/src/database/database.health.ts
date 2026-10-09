import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { type CheckDetails, CheckFailedError } from '../health/checks.js';

@Injectable()
export class DatabaseHealth {
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /** Checks the connection and that the pgvector extension was installed by the migrations. */
  async check(): Promise<CheckDetails> {
    const { rows } = await this.pool.query<{ pgvector: string | null }>(
      "SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector",
    );
    const pgvector = rows[0]?.pgvector;
    if (!pgvector) {
      throw new CheckFailedError('pgvector extension is not installed; run the migrations');
    }
    return { pgvector };
  }
}
