import { setTimeout as sleep } from 'node:timers/promises';

import {
  DiscardPolicy,
  JetStreamApiCodes,
  JetStreamApiError,
  jetstream,
  type JetStreamClient,
  type JetStreamManager,
  jetstreamManager,
  type PubAck,
  RetentionPolicy,
  StorageType,
  type StreamConfig,
} from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect, nanos, type NatsConnection } from '@nats-io/transport-node';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Streams } from '@verarag/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';

const CONNECT_ATTEMPTS = 15;
const CONNECT_RETRY_DELAY_MS = 2_000;
const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Streams owned by the API. The API creates or updates them on startup and
 * the worker only binds its consumers to them, so there is a single place
 * where their limits are defined.
 */
const STREAMS: (Partial<StreamConfig> & { name: string })[] = [
  {
    name: Streams.System.name,
    subjects: [...Streams.System.subjects],
    description: 'Development and diagnostics events. Not product data.',
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_age: nanos(24 * 60 * 60 * 1_000),
    max_msgs: 10_000,
    max_msg_size: 64 * 1_024,
    // Publishing the same event id twice within this window is a no-op.
    duplicate_window: nanos(2 * 60 * 1_000),
    num_replicas: 1,
  },
];

/**
 * The only place in the API that talks to nats.js. The rest of the code uses
 * these few operations, which keeps the NATS client easy to replace in tests.
 */
@Injectable()
export class NatsClient implements OnModuleInit, OnApplicationShutdown {
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @InjectPinoLogger(NatsClient.name) private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = await this.connectWithRetry();
    this.connection = connection;
    void this.logStatusChanges(connection);

    this.js = jetstream(connection);
    this.jsm = await jetstreamManager(connection);
    await this.ensureStreams(this.jsm);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      await this.connection.drain();
    }
  }

  /** Publishes to JetStream. `msgId` lets the server drop duplicates. */
  publish(subject: string, payload: string, msgId: string): Promise<PubAck> {
    return this.jetStreamClient().publish(subject, payload, {
      msgID: msgId,
      timeout: PUBLISH_TIMEOUT_MS,
    });
  }

  /** Round trip to the server. Used by the readiness probe. */
  async ping(): Promise<{ rttMs: number }> {
    return { rttMs: Math.round(await this.natsConnection().rtt()) };
  }

  /** Checks the connection and that JetStream answers for this account. */
  async check(): Promise<{ server: string; streams: number }> {
    const connection = this.natsConnection();
    const account = await this.jetStreamManager().getAccountInfo();
    return { server: connection.info?.version ?? 'unknown', streams: account.streams };
  }

  /**
   * Latest value of every key in a key-value bucket. A bucket that does not
   * exist yet is treated as empty: buckets are created by whoever writes them.
   */
  async readBucket(bucket: string): Promise<Map<string, string>> {
    const values = new Map<string, string>();
    try {
      const kv = await new Kvm(this.jetStreamClient()).open(bucket, { bindOnly: true });
      for await (const key of await kv.keys()) {
        const entry = await kv.get(key);
        if (entry?.operation === 'PUT') {
          values.set(key, entry.string());
        }
      }
    } catch (error) {
      if (!isStreamNotFound(error)) {
        throw error;
      }
    }
    return values;
  }

  private async connectWithRetry(): Promise<NatsConnection> {
    const { servers } = this.config.nats;
    for (let attempt = 1; ; attempt++) {
      try {
        const connection = await connect({
          servers,
          name: 'verarag-api',
          maxReconnectAttempts: -1,
        });
        this.logger.info({ server: connection.getServer() }, 'connected to NATS');
        return connection;
      } catch (error) {
        if (attempt >= CONNECT_ATTEMPTS) {
          throw error;
        }
        this.logger.warn(
          { err: error, attempt, maxAttempts: CONNECT_ATTEMPTS },
          'NATS is not reachable yet, retrying',
        );
        await sleep(CONNECT_RETRY_DELAY_MS);
      }
    }
  }

  private async ensureStreams(jsm: JetStreamManager): Promise<void> {
    for (const stream of STREAMS) {
      try {
        await jsm.streams.info(stream.name);
        await jsm.streams.update(stream.name, stream);
        this.logger.info({ stream: stream.name }, 'stream updated');
      } catch (error) {
        if (!isStreamNotFound(error)) {
          throw error;
        }
        await jsm.streams.add(stream);
        this.logger.info({ stream: stream.name }, 'stream created');
      }
    }
  }

  private async logStatusChanges(connection: NatsConnection): Promise<void> {
    for await (const status of connection.status()) {
      if (status.type === 'disconnect' || status.type === 'reconnect') {
        this.logger.warn({ server: status.server }, `NATS ${status.type}`);
      }
    }
  }

  private natsConnection(): NatsConnection {
    if (!this.connection || this.connection.isClosed()) {
      throw new Error('NATS connection is not open');
    }
    return this.connection;
  }

  private jetStreamClient(): JetStreamClient {
    if (!this.js) {
      throw new Error('NATS connection is not open');
    }
    return this.js;
  }

  private jetStreamManager(): JetStreamManager {
    if (!this.jsm) {
      throw new Error('NATS connection is not open');
    }
    return this.jsm;
  }
}

function isStreamNotFound(error: unknown): boolean {
  return error instanceof JetStreamApiError && error.code === JetStreamApiCodes.StreamNotFound;
}
