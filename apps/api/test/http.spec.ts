import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SystemStatus } from '@verarag/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakes, createTestApp, type Fakes } from './support/test-app.js';

describe('HTTP API', () => {
  let fakes: Fakes;
  let app: NestExpressApplication;

  beforeEach(async () => {
    fakes = createFakes();
    app = await createTestApp(fakes);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /healthz', () => {
    it('answers without touching dependencies', async () => {
      fakes.pool.query.mockRejectedValue(new Error('database is down'));

      await request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' });
    });
  });

  describe('GET /readyz', () => {
    it('is ready when the database answers', async () => {
      const response = await request(app.getHttpServer()).get('/readyz').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        components: [{ name: 'database', status: 'up' }],
      });
    });

    it('returns 503 when the database is unreachable', async () => {
      fakes.pool.query.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const response = await request(app.getHttpServer()).get('/readyz').expect(503);

      expect(response.body).toMatchObject({
        status: 'unavailable',
        components: [{ name: 'database', status: 'down', error: 'unavailable' }],
      });
    });
  });

  describe('GET /api/v1/system/status', () => {
    it('reports every component', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/system/status').expect(200);
      const status = response.body as SystemStatus;

      expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(status).toMatchObject({
        status: 'ok',
        components: [
          { name: 'database', status: 'up', details: { pgvector: '0.8.7' } },
          { name: 'storage', status: 'up', details: { bucket: 'verarag-documents' } },
        ],
      });
    });

    it('reports a degraded system when a component is down', async () => {
      fakes.storage.checkBucket.mockRejectedValue(new Error('socket hang up'));

      const response = await request(app.getHttpServer()).get('/api/v1/system/status').expect(200);
      const status = response.body as SystemStatus;

      expect(status.status).toBe('degraded');
      expect(status.components[1]).toMatchObject({
        name: 'storage',
        status: 'down',
        error: 'unavailable',
      });
    });
  });

  describe('request ids', () => {
    it('echoes a valid incoming request id', async () => {
      const response = await request(app.getHttpServer())
        .get('/healthz')
        .set('x-request-id', 'smoke-test-42')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('smoke-test-42');
    });

    it('creates one when the client does not send it', async () => {
      const response = await request(app.getHttpServer()).get('/healthz').expect(200);

      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('sends security headers', async () => {
    const response = await request(app.getHttpServer()).get('/healthz').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('exposes Prometheus metrics labelled by route', async () => {
    await request(app.getHttpServer()).get('/api/v1/system/status').expect(200);

    const response = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain(
      'http_server_request_duration_seconds_count{method="GET",route="/api/v1/system/status",status_code="200"} 1',
    );
    expect(response.text).toContain('process_cpu_seconds_total');
  });

  it('returns 404 for unknown routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/unknown').expect(404);
  });
});
