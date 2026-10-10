import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

import { CONFIG, type Config } from '../config/config.js';
import { type CheckDetails, CheckFailedError } from '../health/checks.js';
import { MetricsService } from '../observability/metrics.service.js';
import { tracer } from '../observability/tracing.service.js';

/**
 * Multipart uploads read the body in parts of this size, and keep at most
 * UPLOAD_QUEUE_SIZE of them in flight. That bounds the memory of one upload
 * to a few parts, whatever the size of the file: 5 MiB is the smallest part
 * S3 accepts.
 */
export const UPLOAD_PART_SIZE = 5 * 1024 * 1024;
const UPLOAD_QUEUE_SIZE = 2;

export type StorageOperation = 'put' | 'get' | 'head' | 'delete';

/**
 * A storage call that failed. `notFound` is the only failure callers treat
 * as an answer; anything else means storage could not be used. The message
 * never carries what the SDK said, which can include endpoints or request ids.
 */
export class StorageError extends Error {
  override name = 'StorageError';

  constructor(
    readonly operation: StorageOperation,
    readonly notFound: boolean,
    options?: ErrorOptions,
  ) {
    super(`storage ${operation} failed${notFound ? ': not found' : ''}`, options);
  }
}

export interface StoredObject {
  body: Readable;
  size?: number;
}

/**
 * Access to object storage through the S3 API. MinIO in local development,
 * and AWS S3, Cloudflare R2 or any other S3-compatible service elsewhere:
 * switching between them is a matter of configuration, not code.
 *
 * Deliberately small: the four operations documents need, all streaming.
 * Nothing here knows about documents, tenants or key layouts.
 */
@Injectable()
export class ObjectStorage implements OnApplicationShutdown {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(
    @Inject(CONFIG) config: Config,
    private readonly metrics: MetricsService,
  ) {
    const { endpoint, region, bucket, credentials, forcePathStyle } = config.storage;
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      forcePathStyle,
      maxAttempts: 2,
      // Fail fast when storage is down instead of hanging the request: a
      // connection must open within 3 s, and an open one must not go quiet
      // for 30 s.
      requestHandler: { connectionTimeout: 3_000, requestTimeout: 30_000 },
      ...(endpoint ? { endpoint } : {}),
      ...(credentials ? { credentials } : {}),
    });
  }

  /**
   * Streams `body` into `key` with a multipart upload, so the whole object is
   * never held in memory. A failed upload is aborted and leaves no parts
   * behind.
   */
  put(key: string, body: Readable, contentType: string): Promise<void> {
    return this.instrument('put', key, async () => {
      const upload = new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
        partSize: UPLOAD_PART_SIZE,
        queueSize: UPLOAD_QUEUE_SIZE,
        leavePartsOnError: false,
      });
      await upload.done();
    });
  }

  /** The object's size, or undefined when it does not exist. */
  head(key: string): Promise<{ size: number } | undefined> {
    return this.instrument('head', key, async () => {
      try {
        const result = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    });
  }

  /** A stream of the object's content. The caller must consume or destroy it. */
  get(key: string): Promise<StoredObject> {
    return this.instrument('get', key, async () => {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { body: result.Body as Readable, size: result.ContentLength };
    });
  }

  /** Deletes the object. Deleting one that does not exist succeeds, as in S3. */
  delete(key: string): Promise<void> {
    return this.instrument('delete', key, async () => {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    });
  }

  async checkBucket(): Promise<CheckDetails> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = httpStatusOf(error);
      if (status === 404) throw new CheckFailedError(`bucket ${this.bucket} does not exist`);
      if (status === 403) throw new CheckFailedError(`access to bucket ${this.bucket} was denied`);
      throw error;
    }
    return { bucket: this.bucket };
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  /** One span and one duration sample per call, and SDK errors turned into StorageError. */
  private async instrument<T>(
    operation: StorageOperation,
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const span = tracer.startSpan(`s3 ${operation}`, {
      kind: SpanKind.CLIENT,
      attributes: { 'rpc.system': 'aws-api', 'rpc.method': operation, 'aws.s3.key': key },
    });
    const stopTimer = this.metrics.storageOperationDuration.startTimer({ operation });
    try {
      const result = await run();
      stopTimer({ outcome: 'ok' });
      return result;
    } catch (error) {
      stopTimer({ outcome: 'error' });
      span.setStatus({ code: SpanStatusCode.ERROR, message: `s3 ${operation} failed` });
      throw new StorageError(operation, isNotFound(error), { cause: error });
    } finally {
      span.end();
    }
  }
}

function httpStatusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return httpStatusOf(error) === 404 || name === 'NoSuchKey' || name === 'NotFound';
}
