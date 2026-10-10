import { createHash } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';

import type {
  ApiErrorResponse,
  CollectionView,
  DocumentsResponse,
  DocumentView,
  UploadPolicy,
} from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ObjectStorage } from '../../src/storage/object-storage.js';
import { addMember, type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';
import { createTestBucket, type TestBucket } from '../support/s3.js';
import { listen, streamUpload } from '../support/uploads.js';
import { buildDocx, buildPdf, buildZip } from '../support/zip.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;
const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SMALL_LIMIT = 64 * 1024;

describe('document uploads', () => {
  let bucket: TestBucket;
  let ctx: IntegrationContext;
  /** Same database and bucket, with a small size limit. */
  let small: IntegrationContext;

  beforeAll(async () => {
    bucket = await createTestBucket();
    ctx = await startIntegrationApp({ realStorage: true, config: { storage: bucket.config } });
    small = await startIntegrationApp({
      realStorage: true,
      database: ctx.db,
      config: { storage: bucket.config, documents: { maxSizeBytes: SMALL_LIMIT } },
    });
  });

  afterAll(async () => {
    await small.close();
    await ctx.close();
    await bucket.drop();
  });

  async function setup(context = ctx) {
    const owner = await signUp(context);
    const collection = (
      await owner.client
        .post(`/api/v1/organizations/${owner.organizationId}/collections`)
        .send({ name: 'Manuals' })
        .expect(201)
    ).body as CollectionView;
    const documentsPath = `/api/v1/organizations/${owner.organizationId}/collections/${collection.id}/documents`;
    return { owner, collection, documentsPath };
  }

  const upload = (person: Person, path: string, name: string, content: Buffer, type?: string) =>
    person.client
      .post(path)
      .attach('file', content, { filename: name, ...(type ? { contentType: type } : {}) });

  async function documentRow(id: string) {
    const { rows } = await ctx.db.pool.query<{
      storage_status: string;
      failure_reason: string | null;
      object_key: string;
    }>('SELECT storage_status, failure_reason, object_key FROM documents WHERE id = $1', [id]);
    return rows[0];
  }

  describe('accepted files', () => {
    it('stores a Markdown file and its metadata, with the right checksum', async () => {
      const { owner, collection, documentsPath } = await setup();
      const content = Buffer.from('# Getting started\n\nInstall it, then run it.\n');

      const response = await upload(
        owner,
        documentsPath,
        'guide.md',
        content,
        'text/markdown',
      ).expect(201);

      const document = response.body as DocumentView;
      expect(document).toMatchObject({
        collectionId: collection.id,
        filename: 'guide.md',
        mediaType: 'text/markdown',
        sizeBytes: content.length,
        sha256: sha256(content),
        status: 'AVAILABLE',
        failureReason: null,
        createdBy: { type: 'user', id: owner.userId },
      });
      expect(document).not.toHaveProperty('objectKey');
      const key = `organizations/${owner.organizationId}/documents/${document.id}/source`;
      expect((await documentRow(document.id))?.object_key).toBe(key);
      expect((await bucket.read(key)).equals(content)).toBe(true);
    });

    it.each([
      ['manual.pdf', 'application/pdf', buildPdf()],
      ['report.docx', DOCX, buildDocx()],
      ['notes.txt', 'text/plain', Buffer.from('plain text, ñandú\n')],
      ['page.html', 'text/html', Buffer.from('<h1>Hello</h1><script>alert(1)</script>')],
      ['unknown.pdf', 'application/octet-stream', buildPdf()],
    ])('accepts %s', async (name, type, content) => {
      const { owner, documentsPath } = await setup();

      const response = await upload(owner, documentsPath, name, content, type).expect(201);

      expect(response.body).toMatchObject({ status: 'AVAILABLE', sizeBytes: content.length });
    });

    it('keeps the file name as metadata only, cleaned of paths and control characters', async () => {
      const { owner, documentsPath } = await setup();

      const response = await upload(
        owner,
        documentsPath,
        '../../etc/pass‮wd.md',
        Buffer.from('x'),
        'text/markdown',
      ).expect(201);

      const document = response.body as DocumentView;
      expect(document.filename).toBe('passwd.md');
      expect((await documentRow(document.id))?.object_key).not.toContain('passwd');
    });

    it('allows two documents with the same content', async () => {
      const { owner, documentsPath } = await setup();
      const content = Buffer.from('same bytes');

      const first = (await upload(owner, documentsPath, 'a.txt', content).expect(201))
        .body as DocumentView;
      const second = (await upload(owner, documentsPath, 'b.txt', content).expect(201))
        .body as DocumentView;

      expect(first.sha256).toBe(second.sha256);
      expect(first.id).not.toBe(second.id);
    });

    it('lists the documents of the collection and shows each one', async () => {
      const { owner, collection, documentsPath } = await setup();
      const first = (await upload(owner, documentsPath, 'one.txt', Buffer.from('1')).expect(201))
        .body as DocumentView;
      const second = (await upload(owner, documentsPath, 'two.txt', Buffer.from('2')).expect(201))
        .body as DocumentView;

      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      const one = await owner.client
        .get(`/api/v1/organizations/${owner.organizationId}/documents/${first.id}`)
        .expect(200);
      const detail = await owner.client
        .get(`/api/v1/organizations/${owner.organizationId}/collections/${collection.id}`)
        .expect(200);

      expect(list.documents.map((d) => d.id)).toEqual([second.id, first.id]);
      expect(one.body).toEqual(first);
      expect((detail.body as CollectionView).documentCount).toBe(2);
    });

    it('records the upload in the audit log without the file name', async () => {
      const { owner, documentsPath } = await setup();
      const document = (
        await upload(owner, documentsPath, 'secret-plans.txt', Buffer.from('audit me')).expect(201)
      ).body as DocumentView;

      const { rows } = await ctx.db.pool.query<{ action: string; metadata: object }>(
        "SELECT action, metadata FROM audit_events WHERE resource_id = $1 AND action = 'DOCUMENT_UPLOADED'",
        [document.id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toMatchObject({ mediaType: 'text/plain', sizeBytes: 8 });
      expect(JSON.stringify(rows)).not.toContain('secret-plans');
    });
  });

  describe('refused files', () => {
    it.each([
      ['setup.exe', 'application/octet-stream', Buffer.from('MZ binary')],
      ['photo.png', 'image/png', Buffer.from('png')],
      ['archive.zip', 'application/zip', buildZip({ 'a.txt': 'a' })],
      ['manual.pdf', 'image/png', buildPdf()],
      ['fake.pdf', 'application/pdf', Buffer.from('<html>not a pdf</html>')],
      ['fake.docx', DOCX, Buffer.from('not a zip')],
    ])('refuses %s before storing anything', async (name, type, content) => {
      const { owner, documentsPath } = await setup();

      const response = await upload(owner, documentsPath, name, content, type).expect(415);

      expect(errorCode(response.body)).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      expect(list.documents).toEqual([]);
    });

    it.each([
      ['plain.docx', DOCX, buildZip({ 'notes.txt': 'a ZIP, not a Word document' })],
      ['binary.txt', 'text/plain', Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x20])],
    ])(
      'marks %s as failed when the content gives it away, and keeps no object',
      async (name, type, content) => {
        const { owner, documentsPath } = await setup();

        const response = await upload(owner, documentsPath, name, content, type).expect(415);

        expect(errorCode(response.body)).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
        const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
        expect(list.documents).toMatchObject([
          { filename: name, status: 'FAILED', failureReason: 'type_not_allowed', sha256: null },
        ]);
        expect(await bucket.exists((await documentRow(list.documents[0]!.id))!.object_key)).toBe(
          false,
        );
      },
    );

    it('refuses requests that are not one file in a "file" part', async () => {
      const { owner, documentsPath } = await setup();

      for (const response of [
        await owner.client.post(documentsPath).send({ file: 'json' }),
        await owner.client.post(documentsPath).attach('document', Buffer.from('x'), 'a.txt'),
        await owner.client.post(documentsPath).field('note', 'x'),
        await upload(owner, documentsPath, 'empty.txt', Buffer.alloc(0)),
      ]) {
        expect(response.status).toBe(400);
        expect(errorCode(response.body)).toBe('INVALID_UPLOAD');
      }
    });

    it('refuses a declared size over the limit before reading the body', async () => {
      const { owner, documentsPath } = await setup(small);

      const response = await upload(
        owner,
        documentsPath,
        'big.txt',
        Buffer.alloc(SMALL_LIMIT * 3, 'a'),
      ).expect(413);

      expect(errorCode(response.body)).toBe('DOCUMENT_TOO_LARGE');
      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      expect(list.documents).toEqual([]);
    });

    it('stops a chunked upload as soon as it goes over the limit', async () => {
      const { owner, documentsPath } = await setup(small);
      const baseUrl = await listen(small.app);
      let sent = 0;

      const { response, finished } = streamUpload(
        baseUrl,
        documentsPath,
        owner.cookie,
        { name: 'endless.txt', type: 'text/plain' },
        async (write) => {
          // Up to 100 times the limit, unless the server answers first.
          for (let i = 0; i < 100 * 16; i += 1) {
            await write(Buffer.alloc(SMALL_LIMIT / 16, 'a'));
            sent += SMALL_LIMIT / 16;
            if (i % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 5));
          }
        },
      );
      const result = await response;

      expect(result.status).toBe(413);
      expect(errorCode(result.body)).toBe('DOCUMENT_TOO_LARGE');
      expect(finished()).toBe(false);
      expect(sent).toBeLessThan(SMALL_LIMIT * 100);
      const list = (await owner.client.get(documentsPath).expect(200)).body as DocumentsResponse;
      expect(list.documents).toMatchObject([{ status: 'FAILED', failureReason: 'too_large' }]);
      expect(await bucket.exists((await documentRow(list.documents[0]!.id))!.object_key)).toBe(
        false,
      );
    });
  });

  describe('streaming', () => {
    it('sends the file to storage while the request is still arriving', async () => {
      const { owner, documentsPath } = await setup();
      const baseUrl = await listen(ctx.app);
      const storage = ctx.app.get(ObjectStorage);
      const originalPut = storage.put.bind(storage);
      let consumed = 0;
      storage.put = (key: string, body: Readable, type: string) => {
        const counted = new PassThrough();
        counted.on('data', (chunk: Buffer) => {
          consumed += chunk.length;
        });
        body.pipe(counted);
        return originalPut(key, counted, type);
      };
      const chunk = Buffer.alloc(256 * 1024, 'line of text\n');
      const half = 24; // 6 MiB, more than one 5 MiB storage part
      let consumedBeforeEnd = 0;

      try {
        const { response } = streamUpload(
          baseUrl,
          documentsPath,
          owner.cookie,
          { name: 'big.md', type: 'text/markdown' },
          async (write) => {
            for (let i = 0; i < half; i += 1) await write(chunk);
            // Wait until storage has read part of the file before sending the rest.
            const deadline = Date.now() + 10_000;
            while (consumed < 5 * 1024 * 1024 && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            consumedBeforeEnd = consumed;
            for (let i = 0; i < half; i += 1) await write(chunk);
          },
        );
        const result = await response;

        expect(result.status).toBe(201);
        expect(consumedBeforeEnd).toBeGreaterThanOrEqual(5 * 1024 * 1024);
        expect((result.body as DocumentView).sizeBytes).toBe(chunk.length * half * 2);
      } finally {
        storage.put = originalPut;
      }
    });
  });

  describe('roles and collections', () => {
    it('lets admins upload, and members and viewers only read', async () => {
      const { owner, documentsPath } = await setup();
      const admin = await signUp(ctx);
      const member = await signUp(ctx);
      const viewer = await signUp(ctx);
      await addMember(ctx, owner.organizationId, admin, 'ADMIN');
      await addMember(ctx, owner.organizationId, member, 'MEMBER');
      await addMember(ctx, owner.organizationId, viewer, 'VIEWER');

      await upload(admin, documentsPath, 'admin.txt', Buffer.from('ok')).expect(201);
      for (const person of [member, viewer]) {
        const response = await upload(person, documentsPath, 'nope.txt', Buffer.from('no'));
        expect(response.status).toBe(403);
        expect(errorCode(response.body)).toBe('INSUFFICIENT_ROLE');
        await person.client.get(documentsPath).expect(200);
      }
    });

    it('refuses unknown collections and keeps non-empty ones from being deleted', async () => {
      const { owner, collection, documentsPath } = await setup();
      const missing = `/api/v1/organizations/${owner.organizationId}/collections/0199a7d2-0000-7000-8000-000000000000/documents`;

      const unknown = await upload(owner, missing, 'a.txt', Buffer.from('a')).expect(404);
      expect(errorCode(unknown.body)).toBe('COLLECTION_NOT_FOUND');
      await owner.client.get(missing).expect(404);

      await upload(owner, documentsPath, 'a.txt', Buffer.from('a')).expect(201);
      const notEmpty = await owner.client
        .delete(`/api/v1/organizations/${owner.organizationId}/collections/${collection.id}`)
        .expect(409);
      expect(errorCode(notEmpty.body)).toBe('COLLECTION_NOT_EMPTY');
    });
  });

  it('publishes the upload policy from the configuration', async () => {
    const owner = await signUp(small);

    const policy = (await owner.client.get('/api/v1/documents/upload-policy').expect(200))
      .body as UploadPolicy;

    expect(policy.maxSizeBytes).toBe(SMALL_LIMIT);
    expect(policy.types.map((type) => type.mediaType)).toEqual([
      'application/pdf',
      DOCX,
      'text/markdown',
      'text/plain',
      'text/html',
    ]);
  });

  it('counts uploads and documents per status without naming them', async () => {
    const metrics = (await ctx.client().get('/metrics').expect(200)).text;

    expect(metrics).toMatch(/^verarag_document_uploads_total\{result="stored"\} [1-9]/m);
    expect(metrics).toMatch(/^verarag_document_uploads_total\{result="rejected"\} [1-9]/m);
    expect(metrics).toMatch(/^verarag_document_upload_bytes_total [1-9]/m);
    expect(metrics).toMatch(/^verarag_documents\{status="AVAILABLE"\} [1-9]/m);
    expect(metrics).not.toMatch(/guide\.md|organizations\/[0-9a-f-]{36}\/documents/);
  });
});
