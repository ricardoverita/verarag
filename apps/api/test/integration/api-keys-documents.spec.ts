import type {
  ApiErrorResponse,
  ApiKeyScope,
  CollectionView,
  CreatedApiKeyResponse,
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

describe('API keys on collections and documents', () => {
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
        .attach('file', Buffer.from(`${name} data`), `${name}.txt`)
        .expect(201)
    ).body as DocumentView;
    return { person, org, collection, document };
  }

  async function keyFor(t: Tenant, scopes: ApiKeyScope[]) {
    const response = await t.person.client
      .post(`${t.org}/api-keys`)
      .send({ name: scopes.join(' '), scopes })
      .expect(201);
    const created = response.body as CreatedApiKeyResponse;
    return { id: created.apiKey.id, auth: { authorization: `Bearer ${created.key}` } };
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

  it('reads collections and documents with the read scopes', async () => {
    const key = await keyFor(a, ['collections:read', 'documents:read']);
    const client = ctx.client();

    await client.get(`${a.org}/collections`).set(key.auth).expect(200);
    const list = await client
      .get(`${a.org}/collections/${a.collection.id}/documents`)
      .set(key.auth)
      .expect(200);
    const content = await client
      .get(`${a.org}/documents/${a.document.id}/content`)
      .set(key.auth)
      .buffer(true)
      .responseType('blob')
      .expect(200);

    expect((list.body as DocumentsResponse).documents.map((d) => d.id)).toEqual([a.document.id]);
    expect((content.body as Buffer).toString()).toBe('Alpha data');
  });

  it('cannot write with read scopes, nor touch documents with system:read', async () => {
    const reader = await keyFor(a, ['collections:read', 'documents:read']);
    const system = await keyFor(a, ['system:read']);
    const client = ctx.client();

    for (const response of [
      await client.post(`${a.org}/collections`).set(reader.auth).send({ name: 'Nope' }),
      await client
        .post(`${a.org}/collections/${a.collection.id}/documents`)
        .set(reader.auth)
        .attach('file', Buffer.from('x'), 'x.txt'),
      await client.delete(`${a.org}/documents/${a.document.id}`).set(reader.auth),
      await client.get(`${a.org}/collections`).set(system.auth),
      await client.get(`${a.org}/documents/${a.document.id}`).set(system.auth),
    ]) {
      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('INSUFFICIENT_SCOPE');
    }
  });

  it('writes with the write scopes, attributed to the key', async () => {
    const key = await keyFor(a, ['collections:write', 'documents:write']);
    const client = ctx.client();

    const collection = (
      await client.post(`${a.org}/collections`).set(key.auth).send({ name: 'By a key' }).expect(201)
    ).body as CollectionView;
    const document = (
      await client
        .post(`${a.org}/collections/${collection.id}/documents`)
        .set(key.auth)
        .attach('file', Buffer.from('from a program'), 'program.txt')
        .expect(201)
    ).body as DocumentView;
    await client.delete(`${a.org}/documents/${document.id}`).set(key.auth).expect(204);

    expect(collection.createdBy).toEqual({
      type: 'apiKey',
      id: key.id,
      name: 'collections:write documents:write',
    });
    expect(document.createdBy).toMatchObject({ type: 'apiKey', id: key.id });
    const { rows } = await ctx.db.pool.query<{
      action: string;
      actor_user_id: string | null;
      actor_api_key_id: string | null;
    }>(
      `SELECT action, actor_user_id, actor_api_key_id FROM audit_events
       WHERE resource_id IN ($1, $2) ORDER BY created_at`,
      [collection.id, document.id],
    );
    expect(rows.map((row) => row.action)).toEqual([
      'COLLECTION_CREATED',
      'DOCUMENT_UPLOADED',
      'DOCUMENT_DELETED',
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ actor_user_id: null, actor_api_key_id: key.id });
    }
  });

  it('a key of organization A cannot read the documents of B', async () => {
    const key = await keyFor(a, ['collections:read', 'documents:read']);
    const client = ctx.client();

    for (const response of [
      await client.get(`${b.org}/collections`).set(key.auth),
      await client.get(`${b.org}/collections/${b.collection.id}/documents`).set(key.auth),
      await client.get(`${b.org}/documents/${b.document.id}`).set(key.auth),
      await client.get(`${b.org}/documents/${b.document.id}/content`).set(key.auth),
    ]) {
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('ORGANIZATION_NOT_FOUND');
    }
    const throughA = await client.get(`${a.org}/documents/${b.document.id}`).set(key.auth);
    expect(throughA.status).toBe(404);
    expect(errorCode(throughA.body)).toBe('DOCUMENT_NOT_FOUND');
  });

  it('a key of organization A cannot write the collections or documents of B', async () => {
    const key = await keyFor(a, ['collections:write', 'documents:write']);
    const client = ctx.client();

    for (const response of [
      await client.post(`${b.org}/collections`).set(key.auth).send({ name: 'Intruder' }),
      await client
        .patch(`${b.org}/collections/${b.collection.id}`)
        .set(key.auth)
        .send({ name: 'X' }),
      await client.delete(`${b.org}/collections/${b.collection.id}`).set(key.auth),
      await client
        .post(`${b.org}/collections/${b.collection.id}/documents`)
        .set(key.auth)
        .attach('file', Buffer.from('x'), 'x.txt'),
      await client.delete(`${b.org}/documents/${b.document.id}`).set(key.auth),
    ]) {
      expect(response.status).toBe(404);
    }
    const intact = (
      await b.person.client.get(`${b.org}/collections/${b.collection.id}`).expect(200)
    ).body as CollectionView;
    expect(intact).toMatchObject({ name: 'Beta files', documentCount: 1 });
  });

  it('keys keep only the scopes they were created with', async () => {
    const key = await keyFor(a, ['system:read']);

    const { rows } = await ctx.db.pool.query<{ scopes: string[] }>(
      'SELECT scopes FROM api_keys WHERE id = $1',
      [key.id],
    );

    expect(rows[0]?.scopes).toEqual(['system:read']);
    const response = await a.person.client
      .post(`${a.org}/api-keys`)
      .send({ name: 'Unknown scope', scopes: ['documents:admin'] })
      .expect(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });
});
