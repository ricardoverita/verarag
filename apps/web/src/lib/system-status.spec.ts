import type { SystemStatus } from '@verarag/contracts';
import { describe, expect, it, vi } from 'vitest';

import { fetchSystemStatus, toComponentViews } from './system-status';

const healthy: SystemStatus = {
  status: 'ok',
  version: '0.1.0',
  checkedAt: '2026-10-09T10:00:00.000Z',
  components: [
    { name: 'database', status: 'up', latencyMs: 3, details: { pgvector: '0.8.7' } },
    { name: 'messaging', status: 'up', latencyMs: 1, details: { server: '2.15.0', streams: 1 } },
    { name: 'worker', status: 'up', latencyMs: 4, details: { instances: 1, version: '0.1.0' } },
    { name: 'storage', status: 'up', latencyMs: 9, details: { bucket: 'verarag-documents' } },
  ],
};

const respondWith = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);

describe('fetchSystemStatus', () => {
  it('calls the status endpoint of the API', async () => {
    const fetchFn = respondWith(Response.json(healthy));

    const result = await fetchSystemStatus('http://api:3001', { fetchFn });

    expect(result).toEqual({ reachable: true, status: healthy });
    expect(fetchFn.mock.calls[0]?.[0]).toEqual(new URL('http://api:3001/api/v1/system/status'));
  });

  it('reports HTTP errors', async () => {
    const fetchFn = respondWith(new Response('busy', { status: 503 }));

    await expect(fetchSystemStatus('http://api:3001', { fetchFn })).resolves.toEqual({
      reachable: false,
      reason: 'the API answered with HTTP 503',
    });
  });

  it('reports responses that are not a system status', async () => {
    const fetchFn = respondWith(Response.json({ hello: 'world' }));

    await expect(fetchSystemStatus('http://api:3001', { fetchFn })).resolves.toMatchObject({
      reachable: false,
      reason: 'the API sent an unexpected response',
    });
  });

  it('reports an unreachable API', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(fetchSystemStatus('http://api:3001', { fetchFn })).resolves.toEqual({
      reachable: false,
      reason: 'the API is not reachable',
    });
  });

  it('gives up after the timeout', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation timed out.', 'TimeoutError')),
          );
        }),
    );

    await expect(fetchSystemStatus('http://api:3001', { fetchFn, timeoutMs: 20 })).resolves.toEqual(
      { reachable: false, reason: 'no answer after 20 ms' },
    );
  });
});

describe('toComponentViews', () => {
  it('lists the API first and then every component', () => {
    const views = toComponentViews({ reachable: true, status: healthy });

    expect(views.map((view) => [view.label, view.state, view.detail])).toEqual([
      ['API', 'healthy', 'version 0.1.0'],
      ['Database', 'healthy', 'PostgreSQL · pgvector 0.8.7'],
      ['Messaging', 'healthy', 'NATS 2.15.0 · JetStream'],
      ['Worker', 'healthy', '1 instance · version 0.1.0'],
      ['Object storage', 'healthy', 'S3 bucket verarag-documents'],
    ]);
  });

  it('shows why a component is unavailable', () => {
    const status: SystemStatus = {
      ...healthy,
      status: 'degraded',
      components: healthy.components.map((component) =>
        component.name === 'worker'
          ? {
              name: 'worker',
              status: 'down',
              latencyMs: 2,
              error: 'no worker is sending heartbeats',
            }
          : component,
      ),
    };

    const worker = toComponentViews({ reachable: true, status }).find(
      (view) => view.key === 'worker',
    );

    expect(worker).toMatchObject({
      state: 'unavailable',
      detail: 'no worker is sending heartbeats',
    });
  });

  it('marks everything else as unknown when the API is down', () => {
    const views = toComponentViews({ reachable: false, reason: 'the API is not reachable' });

    expect(views[0]).toMatchObject({ label: 'API', state: 'unavailable' });
    expect(views.slice(1).every((view) => view.state === 'unknown')).toBe(true);
  });
});
