/**
 * Event types published to NATS. The type of an event is also the subject it
 * is published on, so `system.test` events travel on the `system.test` subject.
 */
export const EventTypes = {
  SystemTest: 'system.test',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/** Mirrors schemas/events/envelope.schema.json. */
export interface EventEnvelope<TType extends EventType, TData> {
  id: string;
  type: TType;
  version: number;
  source: string;
  occurredAt: string;
  correlationId?: string;
  data: TData;
}

export interface SystemTestData {
  message: string;
}

/** Mirrors schemas/events/system.test.schema.json. */
export interface SystemTestEvent extends EventEnvelope<
  typeof EventTypes.SystemTest,
  SystemTestData
> {
  version: 1;
}
