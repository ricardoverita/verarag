import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import { TEMPLATE_DATABASE, withDatabase } from './containers.global-setup.js';

export interface TestDatabase {
  url: string;
  /** A small pool for assertions and fixtures, separate from the app's. */
  pool: pg.Pool;
  drop(): Promise<void>;
}

/** A fresh, migrated database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('postgresAdminUrl');
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`);
  await admin.end();

  const url = withDatabase(adminUrl, name);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  return {
    url,
    pool,
    async drop() {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}
