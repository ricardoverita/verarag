import { ContractValidator } from '@verarag/contracts/validation';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { CheckFailedError } from '../health/checks.js';
import type { NatsClient } from './nats.client.js';
import { WorkerHeartbeats } from './worker-heartbeats.js';

const heartbeat = (instanceId: string, version = '0.1.0') =>
  JSON.stringify({
    instanceId,
    version,
    startedAt: '2026-10-09T10:00:00Z',
    sentAt: '2026-10-09T10:00:10Z',
  });

function createHeartbeats(entries: [string, string][]) {
  const nats = { readBucket: vi.fn().mockResolvedValue(new Map(entries)) };
  const logger = { warn: vi.fn() };
  const heartbeats = new WorkerHeartbeats(
    nats as unknown as NatsClient,
    new ContractValidator(),
    logger as unknown as PinoLogger,
  );
  return { heartbeats, nats, logger };
}

describe('WorkerHeartbeats', () => {
  it('reads the heartbeat bucket shared with the worker', async () => {
    const { heartbeats, nats } = createHeartbeats([['worker-a', heartbeat('worker-a')]]);

    const instances = await heartbeats.liveInstances();

    expect(nats.readBucket).toHaveBeenCalledWith('worker-heartbeats');
    expect(instances).toHaveLength(1);
    expect(instances[0]?.instanceId).toBe('worker-a');
  });

  it('ignores values that do not match the contract', async () => {
    const { heartbeats, logger } = createHeartbeats([
      ['worker-a', heartbeat('worker-a')],
      ['worker-b', '{"instanceId":"worker-b"}'],
      ['worker-c', 'not json'],
    ]);

    const instances = await heartbeats.liveInstances();

    expect(instances.map((instance) => instance.instanceId)).toEqual(['worker-a']);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('summarises the live instances', async () => {
    const { heartbeats } = createHeartbeats([
      ['worker-a', heartbeat('worker-a', '0.1.0')],
      ['worker-b', heartbeat('worker-b', '0.2.0')],
    ]);

    await expect(heartbeats.check()).resolves.toEqual({ instances: 2, version: '0.1.0, 0.2.0' });
  });

  it('fails the check when no worker is reporting', async () => {
    const { heartbeats } = createHeartbeats([]);

    await expect(heartbeats.check()).rejects.toBeInstanceOf(CheckFailedError);
  });
});
