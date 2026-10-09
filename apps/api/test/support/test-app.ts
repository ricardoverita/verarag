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
  logLevel: 'silent',
  http: { host: '127.0.0.1', port: 0 },
  database: { url: 'postgres://verarag:verarag@localhost:5432/verarag', poolMax: 1 },
  storage: { region: 'us-east-1', bucket: 'verarag-documents', forcePathStyle: true },
  nats: { servers: ['nats://localhost:4222'] },
  devEndpointsEnabled: true,
  tracing: {},
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

export async function createTestApp(
  fakes: Fakes = createFakes(),
  config: Config = testConfig,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(Pool)
    .useValue(fakes.pool)
    .overrideProvider(ObjectStorage)
    .useValue(fakes.storage)
    .overrideProvider(NatsClient)
    .useValue(fakes.nats)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
