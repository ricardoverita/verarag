import { describe, expect, it, vi } from 'vitest';

import { CheckFailedError, runCheck } from './checks.js';

const logger = () => ({ warn: vi.fn() });

describe('runCheck', () => {
  it('reports a component as up with its details', async () => {
    const status = await runCheck(
      'database',
      () => Promise.resolve({ pgvector: '0.8.7' }),
      100,
      logger(),
    );

    expect(status).toMatchObject({
      name: 'database',
      status: 'up',
      details: { pgvector: '0.8.7' },
    });
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    expect(status).not.toHaveProperty('error');
  });

  it('returns the message of a CheckFailedError', async () => {
    const log = logger();
    const status = await runCheck(
      'storage',
      () => Promise.reject(new CheckFailedError('bucket verarag-documents does not exist')),
      100,
      log,
    );

    expect(status).toMatchObject({
      status: 'down',
      error: 'bucket verarag-documents does not exist',
    });
    expect(log.warn).toHaveBeenCalledWith(
      { component: 'storage', reason: 'bucket verarag-documents does not exist' },
      'storage check failed',
    );
  });

  it('hides unexpected errors from the response but logs them', async () => {
    const log = logger();
    const failure = new Error('connect ECONNREFUSED 172.18.0.4:5432');

    const status = await runCheck('database', () => Promise.reject(failure), 100, log);

    expect(status).toMatchObject({ status: 'down', error: 'unavailable' });
    expect(log.warn).toHaveBeenCalledWith(
      { component: 'database', err: failure },
      'database check failed',
    );
  });

  it('fails a check that takes longer than the timeout', async () => {
    const status = await runCheck('storage', () => new Promise(() => {}), 20, logger());

    expect(status).toMatchObject({ status: 'down', error: 'no response after 20 ms' });
  });
});
