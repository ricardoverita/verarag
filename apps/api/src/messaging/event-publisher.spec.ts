import { randomUUID } from 'node:crypto';

import type { SystemTestEvent } from '@verarag/contracts';
import { ContractValidationError, ContractValidator } from '@verarag/contracts/validation';
import type { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetricsService } from '../observability/metrics.service.js';
import { EventPublisher, PublishFailedError } from './event-publisher.js';
import type { NatsClient } from './nats.client.js';

function systemTestEvent(message = 'hello from VeraRAG'): SystemTestEvent {
  return {
    id: randomUUID(),
    type: 'system.test',
    version: 1,
    source: 'api',
    occurredAt: new Date().toISOString(),
    correlationId: 'req-1',
    data: { message },
  };
}

describe('EventPublisher', () => {
  let nats: { publish: ReturnType<typeof vi.fn> };
  let metrics: MetricsService;
  let publisher: EventPublisher;

  const publishedCount = async (outcome: string) => {
    const metric = await metrics.eventsPublished.get();
    return (
      metric.values.find((value) => 'outcome' in value.labels && value.labels.outcome === outcome)
        ?.value ?? 0
    );
  };

  beforeEach(() => {
    nats = { publish: vi.fn().mockResolvedValue({ stream: 'SYSTEM', seq: 7, duplicate: false }) };
    metrics = new MetricsService();
    publisher = new EventPublisher(
      nats as unknown as NatsClient,
      new ContractValidator(),
      metrics,
      { info: vi.fn(), error: vi.fn() } as unknown as PinoLogger,
    );
  });

  it('publishes on the subject named after the event type, using the id for deduplication', async () => {
    const event = systemTestEvent();

    const published = await publisher.publish(event);

    expect(nats.publish).toHaveBeenCalledWith('system.test', JSON.stringify(event), event.id);
    expect(published).toEqual({
      id: event.id,
      type: 'system.test',
      stream: 'SYSTEM',
      sequence: 7,
      duplicate: false,
    });
    expect(await publishedCount('published')).toBe(1);
  });

  it('refuses to publish an event that breaks its contract', async () => {
    const event = { ...systemTestEvent(), occurredAt: 'not a date' };

    await expect(publisher.publish(event)).rejects.toBeInstanceOf(ContractValidationError);
    expect(nats.publish).not.toHaveBeenCalled();
  });

  it('wraps NATS errors and counts the failure', async () => {
    nats.publish.mockRejectedValue(new Error('no responders'));

    await expect(publisher.publish(systemTestEvent())).rejects.toBeInstanceOf(PublishFailedError);
    expect(await publishedCount('failed')).toBe(1);
  });
});
