import { Injectable } from '@nestjs/common';
import type { SystemTestEvent } from '@verarag/contracts';
import { ContractValidator } from '@verarag/contracts/validation';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { MetricsService } from '../observability/metrics.service.js';
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

    try {
      const ack = await this.nats.publish(event.type, JSON.stringify(event), event.id);
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
      this.metrics.eventsPublished.inc({ type: event.type, outcome: 'failed' });
      this.logger.error({ err: error, eventId: event.id, type: event.type }, 'publish failed');
      throw new PublishFailedError(`could not publish ${event.type}`, { cause: error });
    }
  }
}
