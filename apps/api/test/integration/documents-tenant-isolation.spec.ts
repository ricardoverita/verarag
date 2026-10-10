import type {
  ApiErrorResponse,
  CollectionView,
  DocumentsResponse,
  DocumentView,
} from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';
import { createTestBucket, type TestBucket } from '../support/s3.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

interface Tenant {
  person: Person;
  org: string;
  collection: CollectionView;
  document: DocumentView;
}

/**
 * Organization A with collection A and document A, organization B with
 * collection B and document B. Whatever A asks about B must look exactly as
 * if B did not exist, and nothing of B may change.
 */
describe('document tenant isolation', () => {
  let bucket: TestBucket;
  let ctx: IntegrationContext;
  let a: Tenant;
  let b: Tenant;

  async function tenant(name: string): Promise<Tenant> {
    const person = await signUp(ctx, { organizationName: name });
    const org = `/api/v1/organizations/${person.organizationId}`;
    const collection = (
      await person.client
        .post(`${org}/collections`)
        .send({ name: `${name} files` })
        .expect(201)
    ).body as CollectionView;
    const document = (
      await person.client
        .post(`${org}/collections/${collection.id}/documents`)
        .attach('file', Buffer.from(`${name} confidential`), `${name}.txt`)
        .expect(201)
    ).body as DocumentView;
    return { person, org, collection, document };
  }

  beforeAll(async () => {
    bucket = await createTestBucket();
    ctx = await startIntegrationApp({ realStorage: true, config: { storage: bucket.config } });
    a = await tenant('Alpha');
    b = await tenant('Beta');
  });

  afterAll(async () => {
    await ctx.close();
    await bucket.drop();
  });

  it('A cannot reach anything under the path of organization B', async () => {
    const client = a.person.client;
    const responses = [
      await client.get(`${b.org}/collections`),
      await client.get(`${b.org}/collections/${b.collection.id}/documents`),
      await client.get(`${b.org}/documents/${b.document.id}`),
      await client.get(`${b.org}/documents/${b.document.id}/content`),
      await client.delete(`${b.org}/documents/${b.document.id}`),
      await client
        .post(`${b.org}/collections/${b.collection.id}/documents`)
        .attach('file', Buffer.from('intruder'), 'intruder.txt'),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('ORGANIZATION_NOT_FOUND');
    }
  });

  it('A cannot reach B through organization A with B ids', async () => {
    const client = a.person.client;

    for (const response of [
      await client.get(`${a.org}/documents/${b.document.id}`),
      await client.get(`${a.org}/documents/${b.document.id}/content`),
      await client.delete(`${a.org}/documents/${b.document.id}`),
    ]) {
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('DOCUMENT_NOT_FOUND');
    }
    for (const response of [
      await client.get(`${a.org}/collections/${b.collection.id}/documents`),
      await client
        .post(`${a.org}/collections/${b.collection.id}/documents`)
        .attach('file', Buffer.from('intruder'), 'intruder.txt'),
    ]) {
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('COLLECTION_NOT_FOUND');
    }
  });

  it('answers the same for B ids as for ids that do not exist', async () => {
    const missing = '0199a7d2-0000-7000-8000-000000000000';

    const forB = await a.person.client.get(`${a.org}/documents/${b.document.id}`).expect(404);
    const forMissing = await a.person.client.get(`${a.org}/documents/${missing}`).expect(404);

    expect((forB.body as ApiErrorResponse).error.message).toBe(
      (forMissing.body as ApiErrorResponse).error.message,
    );
  });

  it('leaves everything of B untouched and lists only A to A', async () => {
    const listA = (
      await a.person.client.get(`${a.org}/collections/${a.collection.id}/documents`).expect(200)
    ).body as DocumentsResponse;
    expect(listA.documents.map((d) => d.id)).toEqual([a.document.id]);

    const listB = (
      await b.person.client.get(`${b.org}/collections/${b.collection.id}/documents`).expect(200)
    ).body as DocumentsResponse;
    expect(listB.documents).toMatchObject([{ id: b.document.id, status: 'AVAILABLE' }]);
    const content = await b.person.client
      .get(`${b.org}/documents/${b.document.id}/content`)
      .buffer(true)
      .responseType('blob')
      .expect(200);
    expect((content.body as Buffer).toString()).toBe('Beta confidential');
  });

  it('cannot store a document in a collection of another organization, even directly in SQL', async () => {
    const error = await ctx.db.pool
      .query(
        `INSERT INTO documents (organization_id, collection_id, original_filename, media_type, created_by_user_id)
         VALUES ($1, $2, 'x.txt', 'text/plain', $3)`,
        [a.person.organizationId, b.collection.id, a.person.userId],
      )
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: '23503', constraint: 'documents_collection_fkey' });
  });
});
