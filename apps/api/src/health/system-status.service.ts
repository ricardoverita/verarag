import { Injectable } from '@nestjs/common';
import type { ComponentStatus, SystemStatus } from '@verarag/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { DatabaseHealth } from '../database/database.health.js';
import { NatsClient } from '../messaging/nats.client.js';
import { WorkerHeartbeats } from '../messaging/worker-heartbeats.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { APP_VERSION } from '../version.js';
import { runCheck } from './checks.js';

const CHECK_TIMEOUT_MS = 2_000;

/** Concurrent or repeated status requests within this window reuse the same result. */
const STATUS_CACHE_MS = 2_000;

export interface Readiness {
  status: 'ok' | 'unavailable';
  components: ComponentStatus[];
}

@Injectable()
export class SystemStatusService {
  private lastStatus?: { at: number; result: Promise<SystemStatus> };

  constructor(
    private readonly database: DatabaseHealth,
    private readonly nats: NatsClient,
    private readonly workers: WorkerHeartbeats,
    private readonly storage: ObjectStorage,
    @InjectPinoLogger(SystemStatusService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Dependencies the API needs to serve requests. Used by the readiness
   * probe, so an orchestrator stops routing traffic when one of them fails.
   */
  async readiness(): Promise<Readiness> {
    const components = await Promise.all([
      runCheck('database', () => this.database.ping(), CHECK_TIMEOUT_MS, this.logger),
      runCheck('messaging', () => this.nats.ping(), CHECK_TIMEOUT_MS, this.logger),
    ]);
    const ready = components.every((component) => component.status === 'up');
    return { status: ready ? 'ok' : 'unavailable', components };
  }

  /** Detailed status of every component, shown by the web app. */
  getStatus(): Promise<SystemStatus> {
    const now = Date.now();
    if (!this.lastStatus || now - this.lastStatus.at > STATUS_CACHE_MS) {
      this.lastStatus = { at: now, result: this.collectStatus() };
    }
    return this.lastStatus.result;
  }

  private async collectStatus(): Promise<SystemStatus> {
    const components = await Promise.all([
      runCheck('database', () => this.database.check(), CHECK_TIMEOUT_MS, this.logger),
      runCheck('messaging', () => this.nats.check(), CHECK_TIMEOUT_MS, this.logger),
      runCheck('worker', () => this.workers.check(), CHECK_TIMEOUT_MS, this.logger),
      runCheck('storage', () => this.storage.checkBucket(), CHECK_TIMEOUT_MS, this.logger),
    ]);
    return {
      status: components.every((component) => component.status === 'up') ? 'ok' : 'degraded',
      version: APP_VERSION,
      checkedAt: new Date().toISOString(),
      components,
    };
  }
}
