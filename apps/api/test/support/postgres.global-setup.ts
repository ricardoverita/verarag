import { readdir, readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export const TEMPLATE_DATABASE = 'verarag_template';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URL to the server's `postgres` database, for creating test databases. */
    postgresAdminUrl: string;
  }
}

/**
 * Starts one PostgreSQL 18 + pgvector container for the whole run, the same
 * image as Docker Compose, and applies the dbmate migrations to a template
 * database. Each test file then copies the template into its own database.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:0.8.7-pg18')
    .withDatabase('postgres')
    .start();
  const adminUrl = container.getConnectionUri();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  await admin.end();

  const template = new pg.Client({ connectionString: withDatabase(adminUrl, TEMPLATE_DATABASE) });
  await template.connect();
  for (const migration of await readMigrations()) {
    await template.query('BEGIN');
    await template.query(migration);
    await template.query('COMMIT');
  }
  await template.end();

  project.provide('postgresAdminUrl', adminUrl);
  return async () => {
    await container.stop();
  };
}

/** The `-- migrate:up` section of every migration, in order. */
async function readMigrations(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      const up = sql.split('-- migrate:down')[0] ?? '';
      return up.replace('-- migrate:up', '');
    }),
  );
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
