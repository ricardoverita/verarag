import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { Config } from '../../src/config/config.js';
import { ObjectStorage } from '../../src/storage/object-storage.js';

export const testConfig: Config = {
  logLevel: 'silent',
  http: { host: '127.0.0.1', port: 0 },
  database: { url: 'postgres://verarag:verarag@localhost:5432/verarag', poolMax: 1 },
  storage: { region: 'us-east-1', bucket: 'verarag-documents', forcePathStyle: true },
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
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
