import type { ApiErrorResponse, CollectionsResponse, CollectionView } from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

describe('collections', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const path = (person: Person, suffix = '') =>
    `/api/v1/organizations/${person.organizationId}/collections${suffix}`;

  async function create(person: Person, body: object) {
    const response = await person.client.post(path(person)).send(body).expect(201);
    return response.body as CollectionView;
  }

  describe('as an owner', () => {
    it('creates a collection with its creator', async () => {
      const owner = await signUp(ctx, { displayName: 'Olga' });

      const collection = await create(owner, {
        name: '  Product   manuals ',
        description: 'Everything about the product.',
      });

      expect(collection).toMatchObject({
        name: 'Product manuals',
        description: 'Everything about the product.',
        createdBy: { type: 'user', id: owner.userId, displayName: 'Olga' },
      });
    });

    it('refuses a second collection with an equivalent name', async () => {
      const owner = await signUp(ctx);
      await create(owner, { name: 'Contracts' });

      for (const name of ['contracts', ' CONTRACTS ', 'Contracts']) {
        const response = await owner.client.post(path(owner)).send({ name }).expect(409);
        expect(errorCode(response.body)).toBe('COLLECTION_NAME_TAKEN');
      }
    });

    it('lists, reads, renames and clears the description', async () => {
      const owner = await signUp(ctx);
      const b = await create(owner, { name: 'b-collection', description: 'Second' });
      await create(owner, { name: 'A collection' });

      const list = (await owner.client.get(path(owner)).expect(200)).body as CollectionsResponse;
      expect(list.collections.map((c) => c.name)).toEqual(['A collection', 'b-collection']);

      const renamed = await owner.client
        .patch(path(owner, `/${b.id}`))
        .send({ name: 'B collection', description: null })
        .expect(200);
      expect(renamed.body).toMatchObject({ id: b.id, name: 'B collection', description: null });
      await owner.client.get(path(owner, `/${b.id}`)).expect(200);

      const taken = await owner.client
        .patch(path(owner, `/${b.id}`))
        .send({ name: 'a collection' })
        .expect(409);
      expect(errorCode(taken.body)).toBe('COLLECTION_NAME_TAKEN');
    });

    it('deletes an empty collection and frees its name', async () => {
      const owner = await signUp(ctx);
      const collection = await create(owner, { name: 'Temporary' });

      await owner.client.delete(path(owner, `/${collection.id}`)).expect(204);

      const gone = await owner.client.get(path(owner, `/${collection.id}`)).expect(404);
      expect(errorCode(gone.body)).toBe('COLLECTION_NOT_FOUND');
      await owner.client.delete(path(owner, `/${collection.id}`)).expect(404);
      await create(owner, { name: 'Temporary' });
    });

    it('validates names and descriptions', async () => {
      const owner = await signUp(ctx);

      for (const body of [
        {},
        { name: '   ' },
        { name: 'x'.repeat(101) },
        { name: 'Ok', description: 'x'.repeat(1001) },
      ]) {
        const response = await owner.client.post(path(owner)).send(body).expect(400);
        expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
      }
      const collection = await create(owner, { name: 'Valid' });
      await owner.client
        .patch(path(owner, `/${collection.id}`))
        .send({})
        .expect(400);
      await owner.client.get(path(owner, '/not-a-uuid')).expect(400);
    });

    it('records creations, changes and deletions in the audit log', async () => {
      const owner = await signUp(ctx);
      const collection = await create(owner, { name: 'Audited' });
      await owner.client
        .patch(path(owner, `/${collection.id}`))
        .send({ description: 'New' })
        .expect(200);
      await owner.client.delete(path(owner, `/${collection.id}`)).expect(204);

      const { rows } = await ctx.db.pool.query<{ action: string; metadata: object }>(
        'SELECT action, metadata FROM audit_events WHERE resource_id = $1 ORDER BY created_at',
        [collection.id],
      );
      expect(rows.map((row) => row.action)).toEqual([
        'COLLECTION_CREATED',
        'COLLECTION_UPDATED',
        'COLLECTION_DELETED',
      ]);
      expect(rows[1]?.metadata).toMatchObject({ fields: 'description' });
    });
  });

  describe('roles', () => {
    it('lets admins manage collections, and members and viewers only read them', async () => {
      const owner = await signUp(ctx);
      const admin = await signUp(ctx);
      const member = await signUp(ctx);
      const viewer = await signUp(ctx);
      await addMember(ctx, owner.organizationId, admin, 'ADMIN');
      await addMember(ctx, owner.organizationId, member, 'MEMBER');
      await addMember(ctx, owner.organizationId, viewer, 'VIEWER');
      const base = path(owner);

      const byAdmin = (await admin.client.post(base).send({ name: 'By admin' }).expect(201))
        .body as CollectionView;
      await admin.client.patch(`${base}/${byAdmin.id}`).send({ name: 'Renamed' }).expect(200);

      for (const person of [member, viewer]) {
        await person.client.get(base).expect(200);
        await person.client.get(`${base}/${byAdmin.id}`).expect(200);
        for (const response of [
          await person.client.post(base).send({ name: 'Nope' }),
          await person.client.patch(`${base}/${byAdmin.id}`).send({ name: 'Nope' }),
          await person.client.delete(`${base}/${byAdmin.id}`),
        ]) {
          expect(response.status).toBe(403);
          expect(errorCode(response.body)).toBe('INSUFFICIENT_ROLE');
        }
      }
      await admin.client.delete(`${base}/${byAdmin.id}`).expect(204);
    });
  });

  describe('tenant isolation', () => {
    it('keeps the collections of B away from A', async () => {
      const a = await signUp(ctx);
      const b = await signUp(ctx);
      const theirs = await create(b, { name: 'Private to B' });

      await a.client.get(path(b)).expect(404);
      await a.client.post(path(b)).send({ name: 'Intruder' }).expect(404);
      for (const response of [
        await a.client.get(path(b, `/${theirs.id}`)),
        await a.client.patch(path(b, `/${theirs.id}`)).send({ name: 'Taken' }),
        await a.client.delete(path(b, `/${theirs.id}`)),
      ]) {
        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('ORGANIZATION_NOT_FOUND');
      }
      for (const response of [
        await a.client.get(path(a, `/${theirs.id}`)),
        await a.client.patch(path(a, `/${theirs.id}`)).send({ name: 'Taken' }),
        await a.client.delete(path(a, `/${theirs.id}`)),
      ]) {
        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('COLLECTION_NOT_FOUND');
      }

      const list = (await a.client.get(path(a)).expect(200)).body as CollectionsResponse;
      expect(list.collections).toEqual([]);
      const still = (await b.client.get(path(b, `/${theirs.id}`)).expect(200))
        .body as CollectionView;
      expect(still.name).toBe('Private to B');
    });

    it('allows the same name in different organizations', async () => {
      const a = await signUp(ctx);
      const b = await signUp(ctx);

      await create(a, { name: 'Shared name' });
      await create(b, { name: 'Shared name' });
    });
  });

  it('counts collections in the metrics without naming them', async () => {
    const owner = await signUp(ctx);
    await create(owner, { name: 'Metric collection' });

    const metrics = (await ctx.client().get('/metrics').expect(200)).text;

    expect(metrics).toMatch(/^verarag_collections [1-9]/m);
    expect(metrics).not.toContain('Metric collection');
  });
});
