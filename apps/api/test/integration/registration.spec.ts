import type { ApiErrorResponse, RegisterResponse } from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OrganizationsService } from '../../src/organizations/organizations.service.js';
import {
  type IntegrationContext,
  newAccount,
  startIntegrationApp,
} from '../support/integration.js';

describe('POST /api/v1/auth/register', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const register = (body: object) => ctx.client().post('/api/v1/auth/register').send(body);

  it('creates the user, the organization and an OWNER membership', async () => {
    const account = newAccount({ organizationName: 'Vera Labs' });

    const response = await register(account).expect(201);
    const body = response.body as RegisterResponse;

    expect(body).toMatchObject({
      user: { email: account.email, displayName: account.displayName },
      organization: { name: 'Vera Labs', slug: 'vera-labs' },
      role: 'OWNER',
    });

    const { rows } = await ctx.db.pool.query<{ role: string; status: string }>(
      'SELECT role, status FROM memberships WHERE user_id = $1 AND organization_id = $2',
      [body.user.id, body.organization.id],
    );
    expect(rows).toEqual([{ role: 'OWNER', status: 'active' }]);
  });

  it('stores an Argon2id hash and never returns it', async () => {
    const account = newAccount();

    const response = await register(account).expect(201);

    expect(JSON.stringify(response.body)).not.toMatch(/argon2|password/i);
    const { rows } = await ctx.db.pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [account.email],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(rows[0]?.password_hash).not.toContain(account.password);
  });

  it('records the registration in the audit log', async () => {
    const response = await register(newAccount()).set('x-request-id', 'audit-1').expect(201);
    const { user, organization } = response.body as RegisterResponse;

    const { rows } = await ctx.db.pool.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM audit_events
       WHERE actor_user_id = $1 ORDER BY created_at, action`,
      [user.id],
    );
    expect(rows.map((row) => row.action).sort()).toEqual([
      'ORGANIZATION_CREATED',
      'USER_REGISTERED',
    ]);
    expect(rows.every((row) => JSON.stringify(row.metadata).includes('audit-1'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('password');
    expect(organization.id).toBeTruthy();
  });

  it('normalizes the email and treats it as case-insensitive', async () => {
    const account = newAccount();

    const response = await register({ ...account, email: `  ${account.email.toUpperCase()} ` });
    expect((response.body as RegisterResponse).user.email).toBe(account.email);

    const again = await register({ ...account, email: account.email.toUpperCase() }).expect(409);
    expect((again.body as ApiErrorResponse).error).toMatchObject({
      code: 'EMAIL_UNAVAILABLE',
      message: 'This email cannot be used to create an account.',
    });
  });

  it('gives each organization a unique slug', async () => {
    const first = await register(newAccount({ organizationName: 'Acme Corp' })).expect(201);
    const second = await register(newAccount({ organizationName: 'ACME corp.' })).expect(201);

    expect((first.body as RegisterResponse).organization.slug).toBe('acme-corp');
    expect((second.body as RegisterResponse).organization.slug).toBe('acme-corp-2');
  });

  it('leaves nothing behind when a step of the registration fails', async () => {
    const account = newAccount();
    const organizations = ctx.app.get(OrganizationsService);
    const spy = vi
      .spyOn(organizations, 'createForUser')
      .mockRejectedValueOnce(new Error('simulated failure'));

    const response = await register(account).expect(500);

    expect((response.body as ApiErrorResponse).error.code).toBe('INTERNAL_ERROR');
    const { rows } = await ctx.db.pool.query('SELECT 1 FROM users WHERE email = $1', [
      account.email,
    ]);
    expect(rows).toHaveLength(0);
    spy.mockRestore();
  });

  it.each([
    ['a short password', { password: 'short' }, 'password'],
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['an empty organization name', { organizationName: '   ' }, 'organizationName'],
  ])('rejects %s', async (_case, override, field) => {
    const response = await register({ ...newAccount(), ...override }).expect(400);
    const { error } = response.body as ApiErrorResponse;

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.map((detail) => detail.path)).toContain(field);
    expect(JSON.stringify(error)).not.toContain('short');
  });
});

describe('registration rate limit', () => {
  it('stops a client after five attempts in ten minutes', async () => {
    const ctx = await startIntegrationApp();
    try {
      const client = ctx.client();
      for (let attempt = 0; attempt < 5; attempt++) {
        await client.post('/api/v1/auth/register').send({}).expect(400);
      }
      const response = await client.post('/api/v1/auth/register').send(newAccount());

      expect(response.status).toBe(429);
      expect((response.body as ApiErrorResponse).error.code).toBe('RATE_LIMITED');
    } finally {
      await ctx.close();
    }
  });
});
