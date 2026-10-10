import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiErrorResponse, SystemStatus } from '@verarag/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakes, createTestApp, type Fakes, testConfig } from './support/test-app.js';

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
    it('is ready when the database and NATS answer', async () => {
      const response = await request(app.getHttpServer()).get('/readyz').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        components: [
          { name: 'database', status: 'up' },
          { name: 'messaging', status: 'up' },
        ],
      });
    });

    it('returns 503 when the database is unreachable', async () => {
      fakes.pool.query.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const response = await request(app.getHttpServer()).get('/readyz').expect(503);

      expect(response.body).toMatchObject({
        status: 'unavailable',
        components: [{ name: 'database', status: 'down', error: 'unavailable' }, { status: 'up' }],
      });
    });

    it('returns 503 when NATS is unreachable', async () => {
      fakes.nats.ping.mockRejectedValue(new Error('disconnected'));

      await request(app.getHttpServer()).get('/readyz').expect(503);
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
          { name: 'messaging', status: 'up', details: { server: '2.15.0' } },
          { name: 'worker', status: 'up', details: { instances: 1, version: '0.1.0' } },
          { name: 'storage', status: 'up', details: { bucket: 'verarag-documents' } },
        ],
      });
    });

    it('reports a degraded system when a component is down', async () => {
      fakes.storage.checkBucket.mockRejectedValue(new Error('socket hang up'));
      fakes.nats.readBucket.mockResolvedValue(new Map());

      const response = await request(app.getHttpServer()).get('/api/v1/system/status').expect(200);
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
  });

  describe('POST /api/v1/dev/events', () => {
    const publish = (body: object) =>
      request(app.getHttpServer()).post('/api/v1/dev/events').send(body);

    it('publishes a system.test event and returns where it was stored', async () => {
      const response = await publish({ type: 'system.test', message: 'hello from VeraRAG' })
        .set('x-request-id', 'smoke-1')
        .expect(202);

      expect(response.body).toMatchObject({
        type: 'system.test',
        stream: 'SYSTEM',
        sequence: 1,
        duplicate: false,
      });

      const [subject, payload, msgId] = fakes.nats.publish.mock.calls[0] as [
        string,
        string,
        string,
      ];
      const event = JSON.parse(payload) as Record<string, unknown>;
      expect(subject).toBe('system.test');
      expect(msgId).toBe(event.id);
      expect(event).toMatchObject({
        id: (response.body as { id: string }).id,
        type: 'system.test',
        version: 1,
        source: 'api',
        correlationId: 'smoke-1',
        data: { message: 'hello from VeraRAG' },
      });
    });

    it.each([
      ['an unknown event type', { type: 'document.ingestion.requested', message: 'hi' }],
      ['an empty message', { type: 'system.test', message: '   ' }],
      ['a message over 500 characters', { type: 'system.test', message: 'x'.repeat(501) }],
      ['no message', { type: 'system.test' }],
    ])('rejects %s', async (_case, body) => {
      const response = await publish(body).expect(400);

      expect((response.body as ApiErrorResponse).error.code).toBe('VALIDATION_FAILED');
      expect(fakes.nats.publish).not.toHaveBeenCalled();
    });

    it('says which fields are invalid', async () => {
      const response = await publish({ type: 'system.test', message: '' })
        .set('x-request-id', 'bad-input-1')
        .expect(400);

      expect(response.body).toEqual({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request is not valid.',
          requestId: 'bad-input-1',
          details: [{ path: 'message', message: expect.any(String) as string }],
        },
      });
    });

    it('rejects malformed JSON with the same error format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/dev/events')
        .set('content-type', 'application/json')
        .send('{"type": ')
        .expect(400);

      expect((response.body as ApiErrorResponse).error.code).toBe('VALIDATION_FAILED');
    });

    it('returns 503 when NATS does not accept the event', async () => {
      fakes.nats.publish.mockRejectedValue(new Error('no responders available'));

      const response = await publish({ type: 'system.test', message: 'hello' }).expect(503);

      expect((response.body as ApiErrorResponse).error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('limits how many events a client can publish per minute', async () => {
      for (let i = 0; i < 10; i++) {
        await publish({ type: 'system.test', message: `event ${i}` }).expect(202);
      }

      const response = await publish({ type: 'system.test', message: 'one too many' }).expect(429);

      expect((response.body as ApiErrorResponse).error.code).toBe('RATE_LIMITED');
    });

    it('does not exist when the development endpoints are disabled', async () => {
      const prodApp = await createTestApp(createFakes(), {
        ...testConfig,
        devEndpointsEnabled: false,
      });
      try {
        await request(prodApp.getHttpServer())
          .post('/api/v1/dev/events')
          .send({ type: 'system.test', message: 'hello' })
          .expect(404);
      } finally {
        await prodApp.close();
      }
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
    const response = await request(app.getHttpServer()).get('/api/v1/unknown').expect(404);

    expect((response.body as ApiErrorResponse).error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: expect.any(String) as string,
    });
  });
});
