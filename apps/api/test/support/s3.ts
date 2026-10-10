import { randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { inject } from 'vitest';

import type { Config } from '../../src/config/config.js';

export interface TestBucket {
  /** Storage settings that point the API at this bucket. */
  config: Config['storage'];
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<Buffer>;
  keys(): Promise<string[]>;
  /** Multipart uploads that were started and never completed or aborted. */
  pendingUploads(): Promise<number>;
  drop(): Promise<void>;
}

/** A fresh bucket on the MinIO started by the global setup, for one test file. */
export async function createTestBucket(): Promise<TestBucket> {
  const server = inject('s3');
  const bucket = `test-${randomUUID()}`;
  const config: Config['storage'] = {
    endpoint: server.endpoint,
    region: 'us-east-1',
    bucket,
    credentials: { accessKeyId: server.accessKeyId, secretAccessKey: server.secretAccessKey },
    forcePathStyle: true,
  };
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: config.credentials,
    forcePathStyle: true,
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));

  const keys = async () => {
    const { Contents = [] } = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    return Contents.flatMap((object) => (object.Key ? [object.Key] : []));
  };

  return {
    config,
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async read(key) {
      const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await Body!.transformToByteArray());
    },
    keys,
    async pendingUploads() {
      const { Uploads = [] } = await client.send(
        new ListMultipartUploadsCommand({ Bucket: bucket }),
      );
      return Uploads.length;
    },
    async drop() {
      const existing = await keys();
      if (existing.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: existing.map((Key) => ({ Key })) },
          }),
        );
      }
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      client.destroy();
    },
  };
}

/** Settings for a storage server that is down: nothing listens on that port. */
export function unreachableStorage(bucket: TestBucket): Config['storage'] {
  return { ...bucket.config, endpoint: 'http://127.0.0.1:9' };
}
