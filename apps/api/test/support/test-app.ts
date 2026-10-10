import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { Config } from '../../src/config/config.js';
import { NatsClient } from '../../src/messaging/nats.client.js';
import { ObjectStorage } from '../../src/storage/object-storage.js';

export const testConfig: Config = {
  env: 'test',
  // TEST_LOG_LEVEL=error shows what the API logs while a test runs.
  logLevel: (process.env.TEST_LOG_LEVEL as Config['logLevel'] | undefined) ?? 'silent',
  // Tests send X-Forwarded-For to act as different clients.
  http: { host: '127.0.0.1', port: 0, trustProxy: true },
  database: {
    url: 'postgres://verarag:verarag@localhost:5432/verarag',
    poolMax: 1,
    // Integration tests share one PostgreSQL container while every test file
    // hashes passwords in parallel, so a new connection can take a few
    // seconds. The 3 s production default made the first request of a file
    // fail now and then with a 500.
    connectTimeoutMs: 15_000,
  },
  storage: { region: 'us-east-1', bucket: 'verarag-documents', forcePathStyle: true },
  nats: { servers: ['nats://localhost:4222'] },
  devEndpointsEnabled: true,
  tracing: {},
  web: { publicUrl: 'http://localhost:3000', origin: 'http://localhost:3000' },
  sessions: { ttlHours: 168, cookieSecure: false, cookieName: 'verarag_session' },
  invitations: { ttlHours: 168 },
  openApi: { enabled: true },
  documents: { maxSizeBytes: 25 * 1024 * 1024 },
};

export const workerHeartbeat = {
  instanceId: 'worker-1',
  version: '0.1.0',
  startedAt: '2026-10-09T10:00:00Z',
  sentAt: '2026-10-09T10:00:10Z',
};

/** In-memory stand-ins for the infrastructure, so HTTP tests run without Docker. */
export function createFakes() {
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [{ pgvector: '0.8.7' }] }),
      on: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      bucket: testConfig.storage.bucket,
      checkBucket: vi.fn().mockResolvedValue({ bucket: testConfig.storage.bucket }),
      put: vi.fn().mockResolvedValue(undefined),
      head: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      onApplicationShutdown: vi.fn(),
    },
    nats: {
      publish: vi.fn().mockResolvedValue({ stream: 'SYSTEM', seq: 1, duplicate: false }),
      ping: vi.fn().mockResolvedValue({ rttMs: 1 }),
      check: vi.fn().mockResolvedValue({ server: '2.15.0', streams: 1 }),
      readBucket: vi
        .fn()
        .mockResolvedValue(new Map([['worker-1', JSON.stringify(workerHeartbeat)]])),
    },
  };
}

export type Fakes = ReturnType<typeof createFakes>;

export interface TestAppOptions {
  fakes?: Fakes;
  config?: Partial<Config>;
  /** Use a real PostgreSQL database instead of the in-memory pool. */
  databaseUrl?: string;
  /** Use the real ObjectStorage, configured by `config.storage`, instead of the fake. */
  realStorage?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const fakes = options.fakes ?? createFakes();
  const config: Config = { ...testConfig, ...options.config };
  if (options.databaseUrl) {
    config.database = { ...config.database, url: options.databaseUrl, poolMax: 5 };
  }

  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(NatsClient)
    .useValue(fakes.nats);
  if (!options.realStorage) {
    builder = builder.overrideProvider(ObjectStorage).useValue(fakes.storage);
  }
  if (!options.databaseUrl) {
    builder = builder.overrideProvider(Pool).useValue(fakes.pool);
  }

  const app = (await builder.compile()).createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
