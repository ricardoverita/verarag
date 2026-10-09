import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020, type AnySchemaObject, type ErrorObject } from 'ajv/dist/2020.js';
// ajv-formats is CommonJS; under nodenext its default export is reachable as `.default`.
import ajvFormats from 'ajv-formats';

const SCHEMAS_DIR = fileURLToPath(new URL('../schemas', import.meta.url));

export const WORKER_HEARTBEAT_SCHEMA_ID = 'urn:verarag:schema:status:worker-heartbeat';

/** Each event type has a schema whose id ends with the event type. */
export function eventSchemaId(eventType: string): string {
  return `urn:verarag:schema:events:${eventType}`;
}

export class ContractValidationError extends Error {
  constructor(
    readonly schemaId: string,
    readonly issues: string[],
  ) {
    super(`payload does not match ${schemaId}: ${issues.join('; ')}`);
    this.name = 'ContractValidationError';
  }
}

/**
 * Validates payloads against the JSON Schemas in this package. The Go worker
 * validates against the same files, so both sides agree on what is valid.
 */
export class ContractValidator {
  private readonly ajv = new Ajv2020({ allErrors: true });

  constructor(schemasDir: string = SCHEMAS_DIR) {
    ajvFormats.default(this.ajv, ['uuid', 'date-time']);
    for (const file of findSchemaFiles(schemasDir)) {
      this.ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')) as AnySchemaObject);
    }
  }

  /** Validates an event against the schema registered for its `type`. */
  validateEvent(event: unknown): void {
    const type = isRecord(event) ? event.type : undefined;
    if (typeof type !== 'string') {
      throw new ContractValidationError('event', ['missing event type']);
    }
    this.validate(eventSchemaId(type), event);
  }

  validateWorkerHeartbeat(value: unknown): void {
    this.validate(WORKER_HEARTBEAT_SCHEMA_ID, value);
  }

  private validate(schemaId: string, value: unknown): void {
    const validateFn = this.ajv.getSchema(schemaId);
    if (!validateFn) {
      throw new ContractValidationError(schemaId, ['no schema registered with this id']);
    }
    if (!validateFn(value)) {
      throw new ContractValidationError(schemaId, (validateFn.errors ?? []).map(describeError));
    }
  }
}

function findSchemaFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.schema.json'))
    .sort()
    .map((path) => join(dir, path));
}

function describeError(error: ErrorObject): string {
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
