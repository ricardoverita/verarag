import { Injectable } from '@nestjs/common';
import { WORKER_HEARTBEAT_BUCKET, type WorkerHeartbeat } from '@verarag/contracts';
import { ContractValidator } from '@verarag/contracts/validation';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { type CheckDetails, CheckFailedError } from '../health/checks.js';
import { NatsClient } from './nats.client.js';

/**
 * Reads the heartbeats that worker instances write to a NATS key-value
 * bucket. The bucket has a TTL, so a key only exists while its worker keeps
 * reporting; the API never talks to the workers directly.
 */
@Injectable()
export class WorkerHeartbeats {
  constructor(
    private readonly nats: NatsClient,
    private readonly validator: ContractValidator,
    @InjectPinoLogger(WorkerHeartbeats.name) private readonly logger: PinoLogger,
  ) {}

  async liveInstances(): Promise<WorkerHeartbeat[]> {
    const instances: WorkerHeartbeat[] = [];
    for (const [key, raw] of await this.nats.readBucket(WORKER_HEARTBEAT_BUCKET)) {
      try {
        const heartbeat: unknown = JSON.parse(raw);
        this.validator.validateWorkerHeartbeat(heartbeat);
        instances.push(heartbeat as WorkerHeartbeat);
      } catch (error) {
        this.logger.warn({ key, err: error }, 'ignoring an invalid worker heartbeat');
      }
    }
    return instances;
  }

  async check(): Promise<CheckDetails> {
    const instances = await this.liveInstances();
    if (instances.length === 0) {
      throw new CheckFailedError('no worker is sending heartbeats');
    }
    const versions = [...new Set(instances.map((instance) => instance.version))].sort();
    return { instances: instances.length, version: versions.join(', ') };
  }
}
