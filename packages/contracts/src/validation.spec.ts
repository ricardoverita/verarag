import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EventTypes, type SystemTestEvent } from './events.js';
import type { WorkerHeartbeat } from './status.js';
import { ContractValidationError, ContractValidator } from './validation.js';

const validator = new ContractValidator();

function readExample(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../examples/${path}`, import.meta.url), 'utf8'));
}

function systemTestEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const event: SystemTestEvent = {
    id: randomUUID(),
    type: EventTypes.SystemTest,
    version: 1,
    source: 'api',
    occurredAt: new Date().toISOString(),
    correlationId: 'req-123',
    data: { message: 'hello from VeraRAG' },
  };
  return { ...event, ...overrides };
}

describe('ContractValidator', () => {
  it('accepts the shared examples', () => {
    expect(() => validator.validateEvent(readExample('events/system.test.json'))).not.toThrow();
    expect(() =>
      validator.validateWorkerHeartbeat(readExample('status/worker-heartbeat.json')),
    ).not.toThrow();
  });

  it('accepts events built from the TypeScript types', () => {
    expect(() => validator.validateEvent(systemTestEvent())).not.toThrow();

    const heartbeat: WorkerHeartbeat = {
      instanceId: 'worker-1',
      version: '0.1.0',
      startedAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
    };
    expect(() => validator.validateWorkerHeartbeat(heartbeat)).not.toThrow();
  });

  it.each([
    ['an empty message', { data: { message: '' } }],
    ['a message over 500 characters', { data: { message: 'x'.repeat(501) } }],
    ['missing data', { data: undefined }],
    ['an id that is not a UUID', { id: 'not-a-uuid' }],
    ['an invalid timestamp', { occurredAt: 'yesterday' }],
    ['an unsupported version', { version: 2 }],
  ])('rejects a system.test event with %s', (_case, overrides) => {
    expect(() => validator.validateEvent(systemTestEvent(overrides))).toThrow(
      ContractValidationError,
    );
  });

  it('rejects event types without a schema', () => {
    expect(() => validator.validateEvent(systemTestEvent({ type: 'system.unknown' }))).toThrow(
      /no schema registered/,
    );
  });

  it('rejects values that are not events', () => {
    expect(() => validator.validateEvent('system.test')).toThrow(/missing event type/);
    expect(() => validator.validateEvent(null)).toThrow(/missing event type/);
  });

  it('reports where the payload is invalid', () => {
    try {
      validator.validateEvent(systemTestEvent({ data: {} }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).issues).toContain(
        "/data must have required property 'message'",
      );
    }
  });
});
