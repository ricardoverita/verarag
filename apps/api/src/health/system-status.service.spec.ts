import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseHealth } from '../database/database.health.js';
import type { NatsClient } from '../messaging/nats.client.js';
import type { WorkerHeartbeats } from '../messaging/worker-heartbeats.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { SystemStatusService } from './system-status.service.js';

function createService() {
  const database = {
    ping: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ pgvector: '0.8.7' }),
  };
  const nats = {
    ping: vi.fn().mockResolvedValue({ rttMs: 1 }),
    check: vi.fn().mockResolvedValue({ server: '2.15.0', streams: 1 }),
  };
  const workers = { check: vi.fn().mockResolvedValue({ instances: 1, version: '0.1.0' }) };
  const storage = { checkBucket: vi.fn().mockResolvedValue({ bucket: 'verarag-documents' }) };
  const service = new SystemStatusService(
    database as unknown as DatabaseHealth,
    nats as unknown as NatsClient,
    workers as unknown as WorkerHeartbeats,
    storage as unknown as ObjectStorage,
    { warn: vi.fn() } as unknown as PinoLogger,
  );
  return { service, database, nats, workers, storage };
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

  it('reports the components in a stable order', async () => {
    const { service } = createService();

    const status = await service.getStatus();

    expect(status.status).toBe('ok');
    expect(status.components.map((component) => component.name)).toEqual([
      'database',
      'messaging',
      'worker',
      'storage',
    ]);
  });

  it('is degraded when any component is down', async () => {
    const { service, workers } = createService();
    workers.check.mockRejectedValue(new Error('no heartbeats'));

    const status = await service.getStatus();

    expect(status.status).toBe('degraded');
    expect(status.components.find((component) => component.name === 'worker')?.status).toBe('down');
  });

  it('is ready without the worker or the object storage', async () => {
    const { service, workers, storage } = createService();
    workers.check.mockRejectedValue(new Error('no heartbeats'));
    storage.checkBucket.mockRejectedValue(new Error('timeout'));

    const readiness = await service.readiness();

    expect(readiness.status).toBe('ok');
    expect(readiness.components.map((component) => component.name)).toEqual([
      'database',
      'messaging',
    ]);
  });

  it('is not ready when NATS does not answer', async () => {
    const { service, nats } = createService();
    nats.ping.mockRejectedValue(new Error('disconnected'));

    const readiness = await service.readiness();

    expect(readiness.status).toBe('unavailable');
  });
});
