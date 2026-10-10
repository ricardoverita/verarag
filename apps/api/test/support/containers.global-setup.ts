import { readdir, readFile } from 'node:fs/promises';

import { MinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export const TEMPLATE_DATABASE = 'verarag_template';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

/** The same images as Docker Compose. */
const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.7-pg18';
const MINIO_IMAGE = 'cgr.dev/chainguard/minio:latest';

export interface S3TestServer {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URL to the server's `postgres` database, for creating test databases. */
    postgresAdminUrl: string;
    /** A real S3-compatible server; each test file creates its own bucket. */
    s3: S3TestServer;
  }
}

/**
 * Starts one PostgreSQL 18 + pgvector container and one MinIO container for
 * the whole run, and applies the dbmate migrations to a template database.
 * Each test file then copies the template into its own database.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [container, minio] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('postgres').start(),
    new MinioContainer(MINIO_IMAGE).start(),
  ]);
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
  project.provide('s3', {
    endpoint: minio.getConnectionUrl(),
    accessKeyId: minio.getUsername(),
    secretAccessKey: minio.getPassword(),
  });
  return async () => {
    await Promise.all([container.stop(), minio.stop()]);
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
