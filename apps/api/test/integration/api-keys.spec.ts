import { createHash } from 'node:crypto';

import type { ApiErrorResponse, ApiKeysResponse, CreatedApiKeyResponse } from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

describe('API keys', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const keysPath = (person: Person) => `/api/v1/organizations/${person.organizationId}/api-keys`;

  async function createKey(person: Person, body: object = { name: 'CI status check' }) {
    const response = await person.client.post(keysPath(person)).send(body).expect(201);
    return response.body as CreatedApiKeyResponse;
  }

  const withKey = (key: string, path = '/api/v1/system/status') =>
    ctx.client().get(path).set('authorization', `Bearer ${key}`);

  describe('creation', () => {
    it('returns the key once and stores only its prefix and hash', async () => {
      const owner = await signUp(ctx);

      const { apiKey, key } = await createKey(owner);

      expect(key).toMatch(/^vrg_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
      expect(key.startsWith(`${apiKey.prefix}_`)).toBe(true);
      expect(apiKey).toMatchObject({
        name: 'CI status check',
        scopes: ['system:read'],
        status: 'active',
        createdBy: { id: owner.userId },
        expiresAt: null,
        lastUsedAt: null,
      });
      const { rows } = await ctx.db.pool.query<{ key_hash: Buffer }>(
        'SELECT * FROM api_keys WHERE id = $1',
        [apiKey.id],
      );
      expect(rows[0]?.key_hash).toEqual(createHash('sha256').update(key).digest());
      expect(JSON.stringify(rows)).not.toContain(key);
      const audit = await ctx.db.pool.query(
        "SELECT * FROM audit_events WHERE action = 'API_KEY_CREATED' AND resource_id = $1",
        [apiKey.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows)).not.toContain(key);
    });

    it('never shows the key again', async () => {
      const owner = await signUp(ctx);
      const { key } = await createKey(owner);

      const list = await owner.client.get(keysPath(owner)).expect(200);

      expect(JSON.stringify(list.body)).not.toContain(key);
      expect((list.body as ApiKeysResponse).apiKeys[0]).not.toHaveProperty('key');
    });

    it('can expire', async () => {
      const owner = await signUp(ctx);

      const { apiKey } = await createKey(owner, { name: 'Short lived', expiresInDays: 30 });

      const days = (Date.parse(apiKey.expiresAt!) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);
    });

    it('validates the request', async () => {
      const owner = await signUp(ctx);

      for (const body of [
        { name: '' },
        { name: 'Key', scopes: ['documents:write'] },
        { name: 'Key', scopes: [] },
        { name: 'Key', expiresInDays: 0 },
      ]) {
        const response = await owner.client.post(keysPath(owner)).send(body).expect(400);
        expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
      }
    });

    it('is reserved to owners and admins', async () => {
      const owner = await signUp(ctx);
      const admin = await signUp(ctx);
      const member = await signUp(ctx);
      const viewer = await signUp(ctx);
      await addMember(ctx, owner.organizationId, admin, 'ADMIN');
      await addMember(ctx, owner.organizationId, member, 'MEMBER');
      await addMember(ctx, owner.organizationId, viewer, 'VIEWER');
      const path = keysPath(owner);

      await admin.client.post(path).send({ name: 'By admin' }).expect(201);
      await admin.client.get(path).expect(200);
      for (const person of [member, viewer]) {
        const response = await person.client.post(path).send({ name: 'Nope' }).expect(403);
        expect(errorCode(response.body)).toBe('INSUFFICIENT_ROLE');
        await person.client.get(path).expect(403);
      }
    });
  });

  describe('authentication', () => {
    it('reads the system status with the system:read scope and records the use', async () => {
      const owner = await signUp(ctx);
      const { apiKey, key } = await createKey(owner);

      const response = await withKey(key).expect(200);

      expect(response.body).toHaveProperty('components');
      const list = (await owner.client.get(keysPath(owner)).expect(200)).body as ApiKeysResponse;
      expect(list.apiKeys.find((k) => k.id === apiKey.id)?.lastUsedAt).not.toBeNull();
    });

    it('cannot call routes that do not accept API keys', async () => {
      const owner = await signUp(ctx);
      const { key } = await createKey(owner);

      for (const path of [
        '/api/v1/auth/me',
        '/api/v1/organizations',
        `/api/v1/organizations/${owner.organizationId}`,
        `/api/v1/organizations/${owner.organizationId}/members`,
        keysPath(owner),
      ]) {
        const response = await withKey(key, path).expect(403);
        expect(errorCode(response.body)).toBe('INSUFFICIENT_SCOPE');
      }
      const create = await ctx
        .client()
        .post(keysPath(owner))
        .set('authorization', `Bearer ${key}`)
        .send({ name: 'Key made by a key' })
        .expect(403);
      expect(errorCode(create.body)).toBe('INSUFFICIENT_SCOPE');
    });

    it('rejects unknown, malformed and tampered keys the same way', async () => {
      const owner = await signUp(ctx);
      const { key } = await createKey(owner);
      const tampered = `${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`;

      for (const value of [
        `vrg_000000000000_${'a'.repeat(43)}`,
        'not-a-key',
        tampered,
        `${key.slice(0, 16)}_${'b'.repeat(43)}`,
      ]) {
        const response = await withKey(value).expect(401);
        expect(errorCode(response.body)).toBe('INVALID_API_KEY');
      }
    });

    it('prefers the bearer key over a session cookie', async () => {
      const owner = await signUp(ctx);

      const response = await owner.client
        .get('/api/v1/auth/me')
        .set('authorization', 'Bearer not-a-key')
        .expect(401);

      expect(errorCode(response.body)).toBe('INVALID_API_KEY');
    });

    it('ignores other authorization schemes', async () => {
      const response = await ctx
        .client()
        .get('/api/v1/system/status')
        .set('authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);

      expect(errorCode(response.body)).toBe('AUTHENTICATION_REQUIRED');
    });

    it('stops working once expired', async () => {
      const owner = await signUp(ctx);
      const { apiKey, key } = await createKey(owner, { name: 'Expiring', expiresInDays: 1 });
      await ctx.db.pool.query(
        "UPDATE api_keys SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1",
        [apiKey.id],
      );

      expect(errorCode((await withKey(key).expect(401)).body)).toBe('API_KEY_EXPIRED');
      const list = (await owner.client.get(keysPath(owner)).expect(200)).body as ApiKeysResponse;
      expect(list.apiKeys[0]?.status).toBe('expired');
    });
  });

  describe('revocation', () => {
    it('stops the key for good', async () => {
      const owner = await signUp(ctx);
      const { apiKey, key } = await createKey(owner);
      await withKey(key).expect(200);

      await owner.client.delete(`${keysPath(owner)}/${apiKey.id}`).expect(204);
      await owner.client.delete(`${keysPath(owner)}/${apiKey.id}`).expect(204);

      expect(errorCode((await withKey(key).expect(401)).body)).toBe('API_KEY_REVOKED');
      const list = (await owner.client.get(keysPath(owner)).expect(200)).body as ApiKeysResponse;
      expect(list.apiKeys[0]).toMatchObject({ id: apiKey.id, status: 'revoked' });
      const audit = await ctx.db.pool.query(
        "SELECT 1 FROM audit_events WHERE action = 'API_KEY_REVOKED' AND resource_id = $1",
        [apiKey.id],
      );
      expect(audit.rows).toHaveLength(1);
    });

    it('reports unknown keys', async () => {
      const owner = await signUp(ctx);

      const response = await owner.client
        .delete(`${keysPath(owner)}/0199a7d2-0000-7000-8000-000000000000`)
        .expect(404);

      expect(errorCode(response.body)).toBe('API_KEY_NOT_FOUND');
    });
  });

  describe('tenant isolation', () => {
    it('keeps the keys of B away from the owner of A', async () => {
      const a = await signUp(ctx);
      const b = await signUp(ctx);
      const { apiKey, key } = await createKey(b);

      await a.client.get(keysPath(b)).expect(404);
      await a.client.post(keysPath(b)).send({ name: 'Intruder' }).expect(404);
      await a.client.delete(`${keysPath(b)}/${apiKey.id}`).expect(404);
      const throughA = await a.client.delete(`${keysPath(a)}/${apiKey.id}`).expect(404);

      expect(errorCode(throughA.body)).toBe('API_KEY_NOT_FOUND');
      const listA = (await a.client.get(keysPath(a)).expect(200)).body as ApiKeysResponse;
      expect(listA.apiKeys).toEqual([]);
      await withKey(key).expect(200);
    });
  });

  it('counts created and rejected keys without labels that identify them', async () => {
    const owner = await signUp(ctx);
    const { apiKey } = await createKey(owner);
    await withKey('not-a-key').expect(401);

    const metrics = (await ctx.client().get('/metrics').expect(200)).text;

    expect(metrics).toMatch(/^verarag_api_keys_created_total [1-9]/m);
    expect(metrics).toMatch(/^verarag_auth_api_key_rejected_total\{reason="invalid"\} [1-9]/m);
    expect(metrics).not.toContain(apiKey.prefix);
  });
});
