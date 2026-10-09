import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';
import { APP_VERSION } from '../version.js';

export const tracer = trace.getTracer('verarag-api', APP_VERSION);

/**
 * Sends traces to an OTLP endpoint (Jaeger, Tempo, an OpenTelemetry
 * Collector...) when OTEL_EXPORTER_OTLP_ENDPOINT is set. Without it the
 * OpenTelemetry API stays a no-op and costs nothing.
 *
 * Spans are created explicitly (HTTP requests and NATS publishing) instead
 * of patching libraries, which does not work reliably with ES modules.
 */
@Injectable()
export class TracingService implements OnModuleInit, OnApplicationShutdown {
  private provider?: NodeTracerProvider;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @InjectPinoLogger(TracingService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    const { endpoint } = this.config.tracing;
    if (!endpoint) {
      return;
    }
    this.provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'verarag-api',
        [ATTR_SERVICE_VERSION]: APP_VERSION,
      }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
        ),
      ],
    });
    // Registers the provider, the async context manager and the W3C
    // trace context propagator globally.
    this.provider.register();
    this.logger.info({ endpoint }, 'tracing enabled');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.provider?.shutdown();
  }
}
