import { Injectable } from '@nestjs/common';
import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { SystemTestEvent } from '@verarag/contracts';
import { ContractValidator } from '@verarag/contracts/validation';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { MetricsService } from '../observability/metrics.service.js';
import { tracer } from '../observability/tracing.service.js';
import { NatsClient } from './nats.client.js';

/** Every event the API can publish. Grows as new events are added to the contracts. */
export type PublishableEvent = SystemTestEvent;

export interface PublishedEvent {
  id: string;
  type: PublishableEvent['type'];
  stream: string;
  sequence: number;
  /** True when JetStream had already stored an event with this id. */
  duplicate: boolean;
}

export class PublishFailedError extends Error {
  override name = 'PublishFailedError';
}

@Injectable()
export class EventPublisher {
  constructor(
    private readonly nats: NatsClient,
    private readonly validator: ContractValidator,
    private readonly metrics: MetricsService,
    @InjectPinoLogger(EventPublisher.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Validates the event against its contract and publishes it on the subject
   * named after its type. An invalid event is a bug in the API, so the
   * validation error is thrown as is.
   */
  async publish(event: PublishableEvent): Promise<PublishedEvent> {
    this.validator.validateEvent(event);

    const span = tracer.startSpan(`publish ${event.type}`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        'messaging.system': 'nats',
        'messaging.destination.name': event.type,
        'messaging.message.id': event.id,
      },
    });
    // The worker continues the trace from the traceparent header.
    const headers: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), span), headers);

    try {
      const ack = await this.nats.publish(event.type, JSON.stringify(event), event.id, headers);
      span.setAttribute('messaging.nats.stream.sequence', ack.seq);
      this.metrics.eventsPublished.inc({ type: event.type, outcome: 'published' });
      this.logger.info(
        { eventId: event.id, type: event.type, stream: ack.stream, sequence: ack.seq },
        'event published',
      );
      return {
        id: event.id,
        type: event.type,
        stream: ack.stream,
        sequence: ack.seq,
        duplicate: ack.duplicate,
      };
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'publish failed' });
      this.metrics.eventsPublished.inc({ type: event.type, outcome: 'failed' });
      this.logger.error({ err: error, eventId: event.id, type: event.type }, 'publish failed');
      throw new PublishFailedError(`could not publish ${event.type}`, { cause: error });
    } finally {
      span.end();
    }
  }
}
