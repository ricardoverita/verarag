import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { CONFIG, type Config } from '../config/config.js';
import { type CheckDetails, CheckFailedError } from '../health/checks.js';

/**
 * Access to object storage through the S3 API. MinIO in local development,
 * and AWS S3, Cloudflare R2 or any other S3-compatible service elsewhere:
 * switching between them is a matter of configuration, not code.
 *
 * For now it only checks that the bucket is reachable. Storing documents is
 * part of phase 2.
 */
@Injectable()
export class ObjectStorage implements OnApplicationShutdown {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(@Inject(CONFIG) config: Config) {
    const { endpoint, region, bucket, credentials, forcePathStyle } = config.storage;
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      forcePathStyle,
      maxAttempts: 2,
      ...(endpoint ? { endpoint } : {}),
      ...(credentials ? { credentials } : {}),
    });
  }

  async checkBucket(): Promise<CheckDetails> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) throw new CheckFailedError(`bucket ${this.bucket} does not exist`);
      if (status === 403) throw new CheckFailedError(`access to bucket ${this.bucket} was denied`);
      throw error;
    }
    return { bucket: this.bucket };
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
