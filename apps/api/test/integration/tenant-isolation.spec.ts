import type { ApiErrorResponse, MeResponse, MembershipSummary } from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { membershipId, type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

/**
 * User A belongs to organization A, user B to organization B. Every request
 * A makes about B must look exactly like B does not exist.
 */
describe('tenant isolation', () => {
  let ctx: IntegrationContext;
  let a: Person;
  let b: Person;
  let bMembership: string;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
    a = await signUp(ctx, { organizationName: 'Organization A' });
    b = await signUp(ctx, { organizationName: 'Organization B' });
    bMembership = await membershipId(ctx, b.organizationId, b);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('A cannot read organization B', async () => {
    const response = await a.client.get(`/api/v1/organizations/${b.organizationId}`).expect(404);

    expect(errorCode(response.body)).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('answers the same for an organization that does not exist', async () => {
    const missing = await a.client
      .get('/api/v1/organizations/0199a7d2-0000-7000-8000-000000000000')
      .expect(404);
    const other = await a.client.get(`/api/v1/organizations/${b.organizationId}`).expect(404);

    expect(missing.body).toMatchObject({ error: { code: 'ORGANIZATION_NOT_FOUND' } });
    expect((other.body as ApiErrorResponse).error.message).toBe(
      (missing.body as ApiErrorResponse).error.message,
    );
  });

  it('A cannot modify organization B', async () => {
    await a.client
      .patch(`/api/v1/organizations/${b.organizationId}`)
      .send({ name: 'Taken over' })
      .expect(404);

    const { rows } = await ctx.db.pool.query<{ name: string }>(
      'SELECT name FROM organizations WHERE id = $1',
      [b.organizationId],
    );
    expect(rows[0]?.name).toBe('Organization B');
  });

  it('A cannot list, change or remove the members of B', async () => {
    const base = `/api/v1/organizations/${b.organizationId}/members`;

    await a.client.get(base).expect(404);
    await a.client.patch(`${base}/${bMembership}`).send({ role: 'VIEWER' }).expect(404);
    await a.client.delete(`${base}/${bMembership}`).expect(404);
  });

  it('A cannot reach a membership of B through organization A', async () => {
    const response = await a.client
      .patch(`/api/v1/organizations/${a.organizationId}/members/${bMembership}`)
      .send({ role: 'VIEWER' })
      .expect(404);

    expect(errorCode(response.body)).toBe('MEMBER_NOT_FOUND');
    const { rows } = await ctx.db.pool.query<{ role: string }>(
      'SELECT role FROM memberships WHERE id = $1',
      [bMembership],
    );
    expect(rows[0]?.role).toBe('OWNER');
  });

  it('A only ever sees organization A', async () => {
    const list = await a.client.get('/api/v1/organizations').expect(200);
    const me = await a.client.get('/api/v1/auth/me').expect(200);

    const names = (list.body as { organizations: MembershipSummary[] }).organizations.map(
      (item) => item.organization.name,
    );
    expect(names).toEqual(['Organization A']);
    expect((me.body as MeResponse).memberships.map((m) => m.organization.id)).toEqual([
      a.organizationId,
    ]);
  });

  it('requires a session for every organization route', async () => {
    const anonymous = ctx.client();

    for (const path of [
      '/api/v1/organizations',
      `/api/v1/organizations/${a.organizationId}`,
      `/api/v1/organizations/${a.organizationId}/members`,
    ]) {
      const response = await anonymous.get(path).expect(401);
      expect(errorCode(response.body)).toBe('AUTHENTICATION_REQUIRED');
    }
  });
});
