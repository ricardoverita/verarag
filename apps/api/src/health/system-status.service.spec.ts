import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseHealth } from '../database/database.health.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { SystemStatusService } from './system-status.service.js';

function createService() {
  const database = {
    ping: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ pgvector: '0.8.7' }),
  };
  const storage = { checkBucket: vi.fn().mockResolvedValue({ bucket: 'verarag-documents' }) };
  const logger = { warn: vi.fn() };
  const service = new SystemStatusService(
    database as unknown as DatabaseHealth,
    storage as unknown as ObjectStorage,
    logger as unknown as PinoLogger,
  );
  return { service, database, storage };
}

describe('SystemStatusService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a recent result instead of hitting every dependency again', async () => {
    vi.useFakeTimers();
    const { service, database } = createService();

    await Promise.all([service.getStatus(), service.getStatus()]);
    expect(database.check).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_500);
    await service.getStatus();
    expect(database.check).toHaveBeenCalledTimes(2);
  });

  it('is degraded when any component is down', async () => {
    const { service, storage } = createService();
    storage.checkBucket.mockRejectedValue(new Error('timeout'));

    const status = await service.getStatus();

    expect(status.status).toBe('degraded');
    expect(status.components.map((component) => component.status)).toEqual(['up', 'down']);
  });

  it('only uses the database for readiness', async () => {
    const { service, database, storage } = createService();

    const readiness = await service.readiness();

    expect(readiness.status).toBe('ok');
    expect(database.ping).toHaveBeenCalled();
    expect(storage.checkBucket).not.toHaveBeenCalled();
  });
});
