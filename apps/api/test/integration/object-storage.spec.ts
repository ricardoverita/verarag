import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MetricsService } from '../../src/observability/metrics.service.js';
import { ObjectStorage, StorageError, UPLOAD_PART_SIZE } from '../../src/storage/object-storage.js';
import { createTestBucket, type TestBucket, unreachableStorage } from '../support/s3.js';
import { testConfig } from '../support/test-app.js';

/** Real round trips against MinIO: the S3 calls documents depend on. */
describe('ObjectStorage', () => {
  let bucket: TestBucket;
  let storage: ObjectStorage;
  let metrics: MetricsService;

  beforeAll(async () => {
    bucket = await createTestBucket();
    metrics = new MetricsService();
    storage = new ObjectStorage({ ...testConfig, storage: bucket.config }, metrics);
  });

  afterAll(async () => {
    storage.onApplicationShutdown();
    await bucket.drop();
  });

  /** Content in small chunks, as it arrives from a request. */
  const streamOf = (content: Buffer) =>
    Readable.from(
      (function* () {
        for (let offset = 0; offset < content.length; offset += 64 * 1024) {
          yield content.subarray(offset, offset + 64 * 1024);
        }
      })(),
    );

  it('stores, reads and deletes an object larger than one part', async () => {
    const content = randomBytes(2 * UPLOAD_PART_SIZE + 1234);
    const key = 'organizations/a/documents/b/source';

    await storage.put(key, streamOf(content), 'application/pdf');

    expect(await storage.head(key)).toEqual({ size: content.length });
    const object = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(chunk as Buffer);
    const read = Buffer.concat(chunks);
    expect(object.size).toBe(content.length);
    expect(createHash('sha256').update(read).digest('hex')).toBe(
      createHash('sha256').update(content).digest('hex'),
    );

    await storage.delete(key);
    expect(await storage.head(key)).toBeUndefined();
    expect(await bucket.exists(key)).toBe(false);
  });

  it('treats deleting a missing object as done', async () => {
    await expect(storage.delete('organizations/a/documents/missing/source')).resolves.toBe(
      undefined,
    );
  });

  it('reports a missing object as not found', async () => {
    const error = await storage
      .get('organizations/a/documents/missing/source')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ operation: 'get', notFound: true });
  });

  it('aborts an upload whose body fails, leaving neither the object nor its parts', async () => {
    const key = 'organizations/a/documents/broken/source';
    const body = Readable.from(
      (function* () {
        yield randomBytes(UPLOAD_PART_SIZE + 1);
        throw new Error('the client went away');
      })(),
    );

    await expect(storage.put(key, body, 'text/plain')).rejects.toBeInstanceOf(StorageError);

    expect(await bucket.exists(key)).toBe(false);
    expect(await bucket.pendingUploads()).toBe(0);
  });

  it('fails fast with a storage error when the server is down', async () => {
    const down = new ObjectStorage(
      { ...testConfig, storage: unreachableStorage(bucket) },
      new MetricsService(),
    );
    const started = Date.now();

    const error = await down.head('anything').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ operation: 'head', notFound: false });
    expect((error as StorageError).message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    expect(Date.now() - started).toBeLessThan(10_000);
    down.onApplicationShutdown();
  });

  it('measures every call without naming objects', async () => {
    const text = await metrics.registry.metrics();

    expect(text).toMatch(
      /verarag_storage_operation_duration_seconds_count\{operation="put",outcome="ok"\} [1-9]/,
    );
    expect(text).toMatch(/operation="get",outcome="error"/);
    expect(text).not.toContain('organizations/');
  });
});
