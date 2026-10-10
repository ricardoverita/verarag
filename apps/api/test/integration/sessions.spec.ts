import { createHash } from 'node:crypto';

import type { ApiErrorResponse, MeResponse } from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type IntegrationContext,
  newAccount,
  startIntegrationApp,
  type TestAgent,
} from '../support/integration.js';

const COOKIE = 'verarag_session';

function sessionCookie(setCookie: string[] | string | undefined): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return headers.find((header) => header.startsWith(`${COOKIE}=`));
}

function tokenOf(cookie: string | undefined): string {
  return decodeURIComponent(cookie?.split(';')[0]?.split('=')[1] ?? '');
}

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

describe('sessions', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function registered(): Promise<{
    client: TestAgent;
    account: ReturnType<typeof newAccount>;
  }> {
    const account = newAccount();
    const client = ctx.client();
    await client.post('/api/v1/auth/register').send(account).expect(201);
    return { client, account };
  }

  it('signs in on registration with an HttpOnly, SameSite=Lax cookie', async () => {
    const response = await ctx
      .client()
      .post('/api/v1/auth/register')
      .send(newAccount())
      .expect(201);
    const cookie = sessionCookie(response.headers['set-cookie']);

    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);
  });

  it('stores only the hash of the session token', async () => {
    const response = await ctx
      .client()
      .post('/api/v1/auth/register')
      .send(newAccount())
      .expect(201);
    const token = tokenOf(sessionCookie(response.headers['set-cookie']));

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await ctx.db.pool.query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT 1',
    );
    expect(rows[0]?.token_hash.equals(createHash('sha256').update(token).digest())).toBe(true);
    const { rows: plain } = await ctx.db.pool.query(
      "SELECT 1 FROM sessions WHERE encode(token_hash, 'escape') LIKE $1",
      [`%${token}%`],
    );
    expect(plain).toHaveLength(0);
  });

  it('returns the user and their organizations from /auth/me', async () => {
    const { client, account } = await registered();

    const response = await client.get('/api/v1/auth/me').expect(200);
    const me = response.body as MeResponse;

    expect(me.user.email).toBe(account.email);
    expect(me.memberships).toEqual([
      expect.objectContaining({
        role: 'OWNER',
        organization: expect.objectContaining({ name: account.organizationName }) as unknown,
      }),
    ]);
    expect(new Date(me.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(me)).not.toMatch(/password|token/i);
  });

  it('requires a session for /auth/me', async () => {
    const response = await ctx.client().get('/api/v1/auth/me').expect(401);

    expect(errorCode(response.body)).toBe('AUTHENTICATION_REQUIRED');
  });

  it('signs in with the right password', async () => {
    const { account } = await registered();
    const client = ctx.client();

    const response = await client
      .post('/api/v1/auth/login')
      .send({ email: account.email.toUpperCase(), password: account.password })
      .expect(200);

    expect(sessionCookie(response.headers['set-cookie'])).toBeDefined();
    expect((response.body as MeResponse).user.email).toBe(account.email);
    await client.get('/api/v1/auth/me').expect(200);
  });

  it('rejects a wrong password and an unknown email with the same error', async () => {
    const { account } = await registered();

    const wrong = await ctx
      .client()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'not the right password' })
      .expect(401);
    const unknown = await ctx
      .client()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: account.password })
      .expect(401);

    expect(wrong.body).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    expect((unknown.body as ApiErrorResponse).error.message).toBe(
      (wrong.body as ApiErrorResponse).error.message,
    );
    expect(sessionCookie(wrong.headers['set-cookie'])).toBeUndefined();
  });

  it('blocks an account after five failed logins, from any address', async () => {
    const { account } = await registered();
    for (let attempt = 0; attempt < 5; attempt++) {
      await ctx
        .client()
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: `wrong password ${attempt}` })
        .expect(401);
    }

    const response = await ctx
      .client()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: account.password })
      .expect(429);

    expect(errorCode(response.body)).toBe('TOO_MANY_ATTEMPTS');
  });

  it('limits login requests from one address', async () => {
    const client = ctx.client();
    for (let attempt = 0; attempt < 10; attempt++) {
      await client
        .post('/api/v1/auth/login')
        .send({ email: `x${attempt}@example.com`, password: 'x' });
    }

    const response = await client
      .post('/api/v1/auth/login')
      .send({ email: 'x@example.com', password: 'x' })
      .expect(429);

    expect(errorCode(response.body)).toBe('RATE_LIMITED');
  });

  it('revokes the session on logout', async () => {
    const { client } = await registered();
    const { rows: before } = await ctx.db.pool.query<{ id: string }>(
      'SELECT id FROM sessions WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
    );
    await client.get('/api/v1/auth/me').expect(200);

    const response = await client.post('/api/v1/auth/logout').expect(204);

    expect(sessionCookie(response.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
    const { rows } = await ctx.db.pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sessions WHERE id = $1',
      [before[0]?.id],
    );
    expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
  });

  it('rejects a revoked session token', async () => {
    const account = newAccount();
    const register = await ctx.client().post('/api/v1/auth/register').send(account).expect(201);
    const cookie = `${COOKIE}=${tokenOf(sessionCookie(register.headers['set-cookie']))}`;
    await ctx.client().post('/api/v1/auth/logout').set('cookie', cookie).expect(204);

    const response = await ctx.client().get('/api/v1/auth/me').set('cookie', cookie).expect(401);

    expect(errorCode(response.body)).toBe('INVALID_SESSION');
  });

  it('rejects an expired session', async () => {
    const register = await ctx
      .client()
      .post('/api/v1/auth/register')
      .send(newAccount())
      .expect(201);
    const token = tokenOf(sessionCookie(register.headers['set-cookie']));
    await ctx.db.pool.query(
      `UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
       WHERE token_hash = $1`,
      [createHash('sha256').update(token).digest()],
    );

    const response = await ctx
      .client()
      .get('/api/v1/auth/me')
      .set('cookie', `${COOKIE}=${token}`)
      .expect(401);

    expect(errorCode(response.body)).toBe('SESSION_EXPIRED');
  });

  it('replaces any session the browser already had when signing in', async () => {
    const { account } = await registered();
    const planted = await ctx.client().post('/api/v1/auth/register').send(newAccount()).expect(201);
    const plantedToken = tokenOf(sessionCookie(planted.headers['set-cookie']));

    const login = await ctx
      .client()
      .post('/api/v1/auth/login')
      .set('cookie', `${COOKIE}=${plantedToken}`)
      .send({ email: account.email, password: account.password })
      .expect(200);

    expect(tokenOf(sessionCookie(login.headers['set-cookie']))).not.toBe(plantedToken);
    await ctx
      .client()
      .get('/api/v1/auth/me')
      .set('cookie', `${COOKIE}=${plantedToken}`)
      .expect(401);
  });

  it('refuses state-changing requests from other sites', async () => {
    const { client } = await registered();

    const response = await client
      .post('/api/v1/auth/logout')
      .set('origin', 'https://evil.example')
      .expect(403);

    expect(errorCode(response.body)).toBe('FORBIDDEN_ORIGIN');
    await client.get('/api/v1/auth/me').expect(200);
    await client.post('/api/v1/auth/logout').set('origin', 'http://localhost:3000').expect(204);
  });

  it('updates last_seen_at at most every five minutes', async () => {
    const { client } = await registered();
    const latest = async () =>
      (
        await ctx.db.pool.query<{ id: string; last_seen_at: Date }>(
          'SELECT id, last_seen_at FROM sessions ORDER BY created_at DESC LIMIT 1',
        )
      ).rows[0]!;
    const first = await latest();

    await client.get('/api/v1/auth/me').expect(200);
    expect((await latest()).last_seen_at).toEqual(first.last_seen_at);

    await ctx.db.pool.query(
      "UPDATE sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = $1",
      [first.id],
    );
    await client.get('/api/v1/auth/me').expect(200);
    expect(Date.now() - (await latest()).last_seen_at.getTime()).toBeLessThan(60_000);
  });

  it('records sign-ins and sign-outs in the audit log and the metrics', async () => {
    const { client, account } = await registered();
    await client.post('/api/v1/auth/logout').expect(204);
    await ctx
      .client()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: account.password })
      .expect(200);

    const { rows } = await ctx.db.pool.query<{ action: string }>(
      `SELECT a.action FROM audit_events a JOIN users u ON u.id = a.actor_user_id
       WHERE u.email = $1 ORDER BY a.created_at`,
      [account.email],
    );
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['USER_LOGGED_OUT', 'USER_LOGGED_IN']),
    );

    const metrics = (await ctx.client().get('/metrics').expect(200)).text;
    expect(metrics).toMatch(/^verarag_auth_login_total [1-9]/m);
    expect(metrics).toMatch(
      /^verarag_auth_login_failed_total\{reason="invalid_credentials"\} [1-9]/m,
    );
    expect(metrics).toMatch(/^verarag_auth_active_sessions [1-9]/m);
    expect(metrics).not.toContain(account.email);
  });
});

describe('secure session cookies', () => {
  it('use the __Host- prefix and the Secure flag', async () => {
    const ctx = await startIntegrationApp({
      config: {
        sessions: { ttlHours: 1, cookieSecure: true, cookieName: '__Host-verarag_session' },
      },
    });
    try {
      const response = await ctx
        .client()
        .post('/api/v1/auth/register')
        .send(newAccount())
        .expect(201);
      const headers = response.headers['set-cookie'] as unknown as string[];

      expect(headers.find((h) => h.startsWith('__Host-verarag_session='))).toMatch(
        /; Path=\/; Expires=.*; HttpOnly; Secure; SameSite=Lax/,
      );
    } finally {
      await ctx.close();
    }
  });
});
