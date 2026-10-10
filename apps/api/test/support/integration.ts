import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestDatabase, type TestDatabase } from './database.js';
import { createFakes, createTestApp, type Fakes, type TestAppOptions } from './test-app.js';

export interface IntegrationContext {
  app: NestExpressApplication;
  db: TestDatabase;
  fakes: Fakes;
  /** A new client with its own IP address and cookie jar. */
  client(): TestAgent;
  close(): Promise<void>;
}

export interface IntegrationOptions extends Omit<TestAppOptions, 'databaseUrl' | 'fakes'> {
  /** Reuse another app's database, to run two API instances side by side. */
  database?: TestDatabase;
}

/**
 * The full API on a fresh PostgreSQL database. NATS stays faked; S3 is faked
 * unless `realStorage` is set, with `config.storage` pointing at a bucket.
 */
export async function startIntegrationApp(
  options: IntegrationOptions = {},
): Promise<IntegrationContext> {
  const { database, ...appOptions } = options;
  const db = database ?? (await createTestDatabase());
  const fakes = createFakes();
  const app = await createTestApp({ ...appOptions, fakes, databaseUrl: db.url });
  return {
    app,
    db,
    fakes,
    client: () => request.agent(app.getHttpServer()).set('x-forwarded-for', nextClientIp()),
    async close() {
      await app.close();
      if (!database) await db.drop();
    },
  };
}

/** A fresh client address, for requests made without supertest. */
export function clientIp(): string {
  return nextClientIp();
}

export type TestAgent = ReturnType<typeof request.agent>;

let clients = 0;

function nextClientIp(): string {
  clients += 1;
  return `10.${(clients >> 16) & 255}.${(clients >> 8) & 255}.${clients & 255}`;
}

let sequence = 0;

/** A valid registration payload with a unique email. */
export function newAccount(overrides: Partial<Record<string, string>> = {}) {
  sequence += 1;
  return {
    email: `person${sequence}.${Date.now()}@example.com`,
    password: 'a long enough password',
    displayName: `Person ${sequence}`,
    organizationName: `Organization ${sequence}`,
    ...overrides,
  };
}
