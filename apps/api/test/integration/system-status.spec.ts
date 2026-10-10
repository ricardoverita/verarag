import type { SystemStatus } from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type IntegrationContext,
  newAccount,
  startIntegrationApp,
} from '../support/integration.js';

describe('GET /api/v1/system/status', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function signedIn() {
    const client = ctx.client();
    await client.post('/api/v1/auth/register').send(newAccount()).expect(201);
    return client;
  }

  it('reports every component to a signed-in user', async () => {
    const client = await signedIn();

    const response = await client.get('/api/v1/system/status').expect(200);
    const status = response.body as SystemStatus;

    expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(status).toMatchObject({
      status: 'ok',
      components: [
        { name: 'database', status: 'up', details: { pgvector: '0.8.7' } },
        { name: 'messaging', status: 'up', details: { server: '2.15.0' } },
        { name: 'worker', status: 'up', details: { instances: 1, version: '0.1.0' } },
        { name: 'storage', status: 'up', details: { bucket: 'verarag-documents' } },
      ],
    });
  });

  it('reports a degraded system when a component is down', async () => {
    const client = await signedIn();
    ctx.fakes.storage.checkBucket.mockRejectedValue(new Error('socket hang up'));
    ctx.fakes.nats.readBucket.mockResolvedValue(new Map());
    // The status is cached for two seconds.
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    const response = await client.get('/api/v1/system/status').expect(200);
    const status = response.body as SystemStatus;

    expect(status.status).toBe('degraded');
    expect(status.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'worker',
          status: 'down',
          error: 'no worker is sending heartbeats',
        }),
        expect.objectContaining({ name: 'storage', status: 'down', error: 'unavailable' }),
      ]),
    );
  });

  it('is not available without a session', async () => {
    await ctx.client().get('/api/v1/system/status').expect(401);
  });
});
