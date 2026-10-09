import type { NestExpressApplication } from '@nestjs/platform-express';
import { SpanKind } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFakes, createTestApp, type Fakes } from './support/test-app.js';

// Vitest isolates test files, so registering a global provider here does not
// affect the other suites.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();

describe('trace propagation', () => {
  let fakes: Fakes;
  let app: NestExpressApplication;

  beforeAll(async () => {
    fakes = createFakes();
    app = await createTestApp(fakes);
  });

  afterAll(async () => {
    await app.close();
    await provider.shutdown();
  });

  it('continues the incoming trace and passes it to the worker in the NATS headers', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';

    await request(app.getHttpServer())
      .post('/api/v1/dev/events')
      .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`)
      .send({ type: 'system.test', message: 'traced' })
      .expect(202);

    const [, , , headers] = fakes.nats.publish.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, string>,
    ];
    expect(headers.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));

    const spans = exporter.getFinishedSpans();
    const server = spans.find((span) => span.kind === SpanKind.SERVER);
    const producer = spans.find((span) => span.kind === SpanKind.PRODUCER);

    expect(server?.name).toBe('POST /api/v1/dev/events');
    expect(server?.spanContext().traceId).toBe(traceId);
    expect(producer?.name).toBe('publish system.test');
    expect(producer?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);
    expect(headers.traceparent).toContain(producer?.spanContext().spanId);
  });

  it('does not trace health probes', async () => {
    exporter.reset();

    await request(app.getHttpServer()).get('/healthz').expect(200);

    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
