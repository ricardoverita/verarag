import { createHash } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type {
  ApiErrorResponse,
  CollectionView,
  DocumentsResponse,
  DocumentView,
} from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';
import { createTestBucket, type TestBucket, unreachableStorage } from '../support/s3.js';
import { buildPdf } from '../support/zip.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;
const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

describe('document downloads and deletions', () => {
  let bucket: TestBucket;
  let ctx: IntegrationContext;
  /** The same API and database, with object storage down. */
  let down: IntegrationContext;

  beforeAll(async () => {
    bucket = await createTestBucket();
    ctx = await startIntegrationApp({ realStorage: true, config: { storage: bucket.config } });
    down = await startIntegrationApp({
      realStorage: true,
      database: ctx.db,
      config: { storage: unreachableStorage(bucket) },
    });
  });

  afterAll(async () => {
    await down.close();
    await ctx.close();
    await bucket.drop();
  });

  async function setup() {
    const owner = await signUp(ctx);
    const collection = (
      await owner.client
        .post(`/api/v1/organizations/${owner.organizationId}/collections`)
        .send({ name: 'Library' })
        .expect(201)
    ).body as CollectionView;
    const org = `/api/v1/organizations/${owner.organizationId}`;
    return { owner, org, documentsPath: `${org}/collections/${collection.id}/documents` };
  }

  async function uploadAs(person: Person, path: string, name: string, content: Buffer) {
    const response = await person.client.post(path).attach('file', content, name).expect(201);
    return response.body as DocumentView;
  }

  /** The same person, signed in on the API instance whose storage is down. */
  function onDownInstance(person: Person) {
    return down.client().set('cookie', person.cookie);
  }

  describe('download', () => {
    it('sends back exactly the bytes that were uploaded', async () => {
      const { owner, org, documentsPath } = await setup();
      const content = buildPdf();
      const document = await uploadAs(owner, documentsPath, 'Manual "v2" año.pdf', content);

      const response = await owner.client
        .get(`${org}/documents/${document.id}/content`)
        .buffer(true)
        .responseType('blob')
        .expect(200);

      const body = response.body as Buffer;
      expect(body.equals(content)).toBe(true);
      expect(sha256(body)).toBe(document.sha256);
      expect(response.headers).toMatchObject({
        'content-type': 'application/pdf',
        'content-length': String(content.length),
        'content-disposition': `attachment; filename="Manual \\"v2\\" a?o.pdf"; filename*=UTF-8''Manual%20%22v2%22%20a%C3%B1o.pdf`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'no-store',
      });
    });

    it('never serves uploaded HTML as a page', async () => {
      const { owner, org, documentsPath } = await setup();
      const content = Buffer.from('<script>document.cookie</script>');
      const document = await uploadAs(owner, documentsPath, 'page.html', content);

      const response = await owner.client
        .get(`${org}/documents/${document.id}/content`)
        .buffer(true)
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(response.headers['content-disposition']).toMatch(/^attachment;/);
      expect(response.headers['content-security-policy']).toContain('sandbox');
    });

    it('is open to every member, viewers included', async () => {
      const { owner, org, documentsPath } = await setup();
      const viewer = await signUp(ctx);
      await addMember(ctx, owner.organizationId, viewer, 'VIEWER');
      const document = await uploadAs(owner, documentsPath, 'shared.txt', Buffer.from('shared'));

      await viewer.client.get(`${org}/documents/${document.id}`).expect(200);
      await viewer.client.get(`${org}/documents/${document.id}/content`).expect(200);
    });

    it('refuses documents that are not stored', async () => {
      const { owner, org, documentsPath } = await setup();
      await owner.client
        .post(documentsPath)
        .attach('file', Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x20]), 'broken.txt')
        .expect(415);
      const [failed] = (
        (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse
      ).documents;

      const response = await owner.client.get(`${org}/documents/${failed!.id}/content`).expect(409);

      expect(errorCode(response.body)).toBe('DOCUMENT_NOT_AVAILABLE');
    });
  });

  describe('deletion', () => {
    it('removes the object, hides the document and can be repeated', async () => {
      const { owner, org, documentsPath } = await setup();
      const document = await uploadAs(owner, documentsPath, 'old.txt', Buffer.from('old'));
      const key = `organizations/${owner.organizationId}/documents/${document.id}/source`;
      expect(await bucket.exists(key)).toBe(true);

      await owner.client.delete(`${org}/documents/${document.id}`).expect(204);

      expect(await bucket.exists(key)).toBe(false);
      for (const path of [
        `${org}/documents/${document.id}`,
        `${org}/documents/${document.id}/content`,
      ]) {
        const response = await owner.client.get(path).expect(404);
        expect(errorCode(response.body)).toBe('DOCUMENT_NOT_FOUND');
      }
      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      expect(list.documents).toEqual([]);
      await owner.client.delete(`${org}/documents/${document.id}`).expect(204);

      const { rows } = await ctx.db.pool.query<{ storage_status: string; deleted_at: Date | null }>(
        'SELECT storage_status, deleted_at FROM documents WHERE id = $1',
        [document.id],
      );
      expect(rows[0]?.storage_status).toBe('DELETED');
      expect(rows[0]?.deleted_at).toBeInstanceOf(Date);
      const audit = await ctx.db.pool.query<{ metadata: object }>(
        "SELECT metadata FROM audit_events WHERE action = 'DOCUMENT_DELETED' AND resource_id = $1",
        [document.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.metadata).toMatchObject({ previousStatus: 'AVAILABLE' });
    });

    it('lets the collection be deleted once its documents are gone', async () => {
      const { owner, org, documentsPath } = await setup();
      const document = await uploadAs(owner, documentsPath, 'last.txt', Buffer.from('last'));
      const collectionPath = documentsPath.replace(/\/documents$/, '');

      await owner.client.delete(collectionPath).expect(409);
      await owner.client.delete(`${org}/documents/${document.id}`).expect(204);
      await owner.client.delete(collectionPath).expect(204);
    });

    it('is reserved to owners and admins', async () => {
      const { owner, org, documentsPath } = await setup();
      const member = await signUp(ctx);
      await addMember(ctx, owner.organizationId, member, 'MEMBER');
      const document = await uploadAs(owner, documentsPath, 'keep.txt', Buffer.from('keep'));

      const response = await member.client.delete(`${org}/documents/${document.id}`).expect(403);

      expect(errorCode(response.body)).toBe('INSUFFICIENT_ROLE');
    });

    it('cleans up an upload that never finished, as after a crash', async () => {
      const { owner, org, documentsPath } = await setup();
      const collectionId = documentsPath.split('/').at(-2)!;
      // The API wrote the row and the object, then died before marking it AVAILABLE.
      const { rows } = await ctx.db.pool.query<{ id: string; object_key: string }>(
        `INSERT INTO documents (organization_id, collection_id, original_filename, media_type, created_by_user_id)
         VALUES ($1, $2, 'crashed.txt', 'text/plain', $3) RETURNING id, object_key`,
        [owner.organizationId, collectionId, owner.userId],
      );
      const { id, object_key: key } = rows[0]!;
      const s3 = new S3Client({ ...bucket.config, forcePathStyle: true });
      await s3.send(
        new PutObjectCommand({ Bucket: bucket.config.bucket, Key: key, Body: 'partial' }),
      );
      s3.destroy();

      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      expect(list.documents).toMatchObject([{ id, status: 'UPLOADING' }]);
      await owner.client.get(`${org}/documents/${id}/content`).expect(409);

      await owner.client.delete(`${org}/documents/${id}`).expect(204);

      expect(await bucket.exists(key)).toBe(false);
    });
  });

  describe('when object storage is down', () => {
    it('marks an upload FAILED, says so without internals, and works again once storage is back', async () => {
      const { owner, documentsPath } = await setup();
      const client = onDownInstance(owner);

      const response = await client
        .post(documentsPath)
        .attach('file', Buffer.from('important'), 'important.txt')
        .expect(503);

      const body = response.body as ApiErrorResponse;
      expect(body.error.code).toBe('DOCUMENT_UPLOAD_FAILED');
      expect(body.error.requestId).toBeDefined();
      expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|stack|S3|aws/i);
      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      expect(list.documents).toMatchObject([
        { filename: 'important.txt', status: 'FAILED', failureReason: 'storage_error' },
      ]);

      // Storage is back: the same file uploads normally, and the failed one can be removed.
      await uploadAs(owner, documentsPath, 'important.txt', Buffer.from('important'));
      await owner.client
        .delete(`/api/v1/organizations/${owner.organizationId}/documents/${list.documents[0]!.id}`)
        .expect(204);
    });

    it('refuses downloads with a clear error', async () => {
      const { owner, org, documentsPath } = await setup();
      const document = await uploadAs(owner, documentsPath, 'later.txt', Buffer.from('later'));
      const client = onDownInstance(owner);

      const response = await client.get(`${org}/documents/${document.id}/content`).expect(503);

      expect(errorCode(response.body)).toBe('STORAGE_UNAVAILABLE');
    });

    it('leaves a deletion pending, visible and resumable', async () => {
      const { owner, org, documentsPath } = await setup();
      const document = await uploadAs(owner, documentsPath, 'remove-me.txt', Buffer.from('bye'));
      const key = `organizations/${owner.organizationId}/documents/${document.id}/source`;
      const client = onDownInstance(owner);

      const failed = await client.delete(`${org}/documents/${document.id}`).expect(503);

      expect(errorCode(failed.body)).toBe('DOCUMENT_DELETE_FAILED');
      expect(await bucket.exists(key)).toBe(true);
      const detail = (await owner.client.get(`${org}/documents/${document.id}`).expect(200))
        .body as DocumentView;
      expect(detail.status).toBe('DELETING');
      await owner.client.get(`${org}/documents/${document.id}/content`).expect(409);

      await owner.client.delete(`${org}/documents/${document.id}`).expect(204);

      expect(await bucket.exists(key)).toBe(false);
      await owner.client.get(`${org}/documents/${document.id}`).expect(404);
    });
  });

  it('counts downloads and deletions by result', async () => {
    const metrics = (await ctx.client().get('/metrics').expect(200)).text;

    expect(metrics).toMatch(/^verarag_document_downloads_total\{result="sent"\} [1-9]/m);
    expect(metrics).toMatch(/^verarag_document_downloads_total\{result="not_available"\} [1-9]/m);
    expect(metrics).toMatch(/^verarag_document_deletes_total\{result="deleted"\} [1-9]/m);
  });
});
