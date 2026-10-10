import { createHash } from 'node:crypto';

import type {
  ApiErrorResponse,
  CreatedInvitationResponse,
  InvitationsResponse,
  MeResponse,
  MemberRole,
  RegisterResponse,
} from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, type Person, signUp } from '../support/fixtures.js';
import {
  type IntegrationContext,
  newAccount,
  startIntegrationApp,
} from '../support/integration.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

describe('invitations', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function invite(person: Person, email: string, role: MemberRole = 'MEMBER') {
    const response = await person.client
      .post(`/api/v1/organizations/${person.organizationId}/invitations`)
      .send({ email, role })
      .expect(201);
    const body = response.body as CreatedInvitationResponse;
    const token = new URL(body.inviteUrl).pathname.split('/').pop()!;
    return { ...body, token };
  }

  const preview = (token: string) =>
    ctx.client().post('/api/v1/invitations/preview').send({ token });

  const registerWith = (token: string) =>
    ctx
      .client()
      .post('/api/v1/invitations/register')
      .send({ token, displayName: 'Invited Person', password: 'a long enough password' });

  describe('creation', () => {
    it('returns the link once and stores only the hash of its token', async () => {
      const owner = await signUp(ctx);
      const email = newAccount().email;

      const { invitation, inviteUrl, token } = await invite(owner, email, 'ADMIN');

      expect(inviteUrl).toBe(`http://localhost:3000/invitations/${token}`);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(invitation).toMatchObject({ email, role: 'ADMIN', status: 'pending' });
      const { rows } = await ctx.db.pool.query<{ token_hash: Buffer }>(
        'SELECT * FROM invitations WHERE id = $1',
        [invitation.id],
      );
      expect(rows[0]?.token_hash).toEqual(createHash('sha256').update(token).digest());
      expect(JSON.stringify(rows)).not.toContain(token);
      const audit = await ctx.db.pool.query(
        "SELECT * FROM audit_events WHERE action = 'MEMBER_INVITED'",
      );
      expect(JSON.stringify(audit.rows)).not.toContain(token);
    });

    it('lists open invitations to owners and admins, never with their links', async () => {
      const owner = await signUp(ctx);
      const admin = await signUp(ctx);
      await addMember(ctx, owner.organizationId, admin, 'ADMIN');
      const { token } = await invite(owner, newAccount().email);

      const response = await admin.client
        .get(`/api/v1/organizations/${owner.organizationId}/invitations`)
        .expect(200);

      const { invitations } = response.body as InvitationsResponse;
      expect(invitations).toHaveLength(1);
      expect(invitations[0]?.invitedBy.id).toBe(owner.userId);
      expect(JSON.stringify(response.body)).not.toContain(token);
      expect(invitations[0]).not.toHaveProperty('inviteUrl');
    });

    it('follows the role rules', async () => {
      const owner = await signUp(ctx);
      const org = owner.organizationId;
      const admin = await signUp(ctx);
      const member = await signUp(ctx);
      const viewer = await signUp(ctx);
      await addMember(ctx, org, admin, 'ADMIN');
      await addMember(ctx, org, member, 'MEMBER');
      await addMember(ctx, org, viewer, 'VIEWER');
      const path = `/api/v1/organizations/${org}/invitations`;

      await owner.client.post(path).send({ email: newAccount().email, role: 'OWNER' }).expect(201);
      await admin.client.post(path).send({ email: newAccount().email, role: 'ADMIN' }).expect(201);
      const adminOwner = await admin.client
        .post(path)
        .send({ email: newAccount().email, role: 'OWNER' })
        .expect(403);
      expect(errorCode(adminOwner.body)).toBe('INSUFFICIENT_ROLE');
      await member.client
        .post(path)
        .send({ email: newAccount().email, role: 'VIEWER' })
        .expect(403);
      await viewer.client.get(path).expect(403);
    });

    it('refuses to invite someone who is already a member', async () => {
      const owner = await signUp(ctx);
      const member = await signUp(ctx);
      await addMember(ctx, owner.organizationId, member, 'MEMBER');

      const response = await owner.client
        .post(`/api/v1/organizations/${owner.organizationId}/invitations`)
        .send({ email: member.email.toUpperCase(), role: 'VIEWER' })
        .expect(409);

      expect(errorCode(response.body)).toBe('ALREADY_A_MEMBER');
    });

    it('replaces the open invitation when the same email is invited again', async () => {
      const owner = await signUp(ctx);
      const email = newAccount().email;
      const first = await invite(owner, email, 'VIEWER');
      const second = await invite(owner, email, 'MEMBER');

      expect(errorCode((await preview(first.token).expect(410)).body)).toBe('INVITATION_REVOKED');
      await preview(second.token).expect(200);
    });
  });

  describe('preview', () => {
    it('shows the organization, the invited email and the role', async () => {
      const owner = await signUp(ctx, { organizationName: 'Preview Org', displayName: 'Olga' });
      const email = newAccount().email;
      const { token, invitation } = await invite(owner, email, 'VIEWER');

      const response = await preview(token).expect(200);

      expect(response.body).toEqual({
        organization: { name: 'Preview Org' },
        email,
        role: 'VIEWER',
        invitedBy: { displayName: 'Olga' },
        expiresAt: invitation.expiresAt,
      });
    });

    it('answers the same for unknown and malformed tokens', async () => {
      for (const token of ['x'.repeat(43), 'not a token', '../../etc']) {
        const response = await preview(token).expect(404);
        expect(errorCode(response.body)).toBe('INVITATION_NOT_FOUND');
      }
    });

    it('reports expired invitations', async () => {
      const owner = await signUp(ctx);
      const { token, invitation } = await invite(owner, newAccount().email);
      await ctx.db.pool.query(
        "UPDATE invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1",
        [invitation.id],
      );

      expect(errorCode((await preview(token).expect(410)).body)).toBe('INVITATION_EXPIRED');
      expect(errorCode((await registerWith(token).expect(410)).body)).toBe('INVITATION_EXPIRED');
    });

    it('is rate limited per client', async () => {
      const client = ctx.client();
      for (let i = 0; i < 20; i++) {
        await client.post('/api/v1/invitations/preview').send({ token: 'unknown' }).expect(404);
      }
      const response = await client
        .post('/api/v1/invitations/preview')
        .send({ token: 'unknown' })
        .expect(429);
      expect(errorCode(response.body)).toBe('RATE_LIMITED');
    });
  });

  describe('accepting with a new account', () => {
    it('creates the account in the organization with the invited role, and signs in', async () => {
      const owner = await signUp(ctx, { organizationName: 'Joined Org' });
      const email = newAccount().email;
      const { token } = await invite(owner, email, 'ADMIN');

      const response = await registerWith(token).expect(201);

      const body = response.body as RegisterResponse;
      expect(body).toMatchObject({
        user: { email, displayName: 'Invited Person' },
        organization: { id: owner.organizationId, name: 'Joined Org' },
        role: 'ADMIN',
      });
      expect(response.headers['set-cookie']?.[0]).toMatch(/^verarag_session=/);
      // No organization of their own: they joined the one that invited them.
      const { rows } = await ctx.db.pool.query(
        "SELECT organization_id FROM memberships WHERE user_id = $1 AND status = 'active'",
        [body.user.id],
      );
      expect(rows).toEqual([{ organization_id: owner.organizationId }]);
      const audit = await ctx.db.pool.query<{ action: string }>(
        'SELECT action FROM audit_events WHERE actor_user_id = $1 ORDER BY created_at',
        [body.user.id],
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        'USER_REGISTERED',
        'INVITATION_ACCEPTED',
      ]);
    });

    it('works only once', async () => {
      const owner = await signUp(ctx);
      const { token } = await invite(owner, newAccount().email);
      await registerWith(token).expect(201);

      expect(errorCode((await registerWith(token).expect(410)).body)).toBe(
        'INVITATION_ALREADY_USED',
      );
      expect(errorCode((await preview(token).expect(410)).body)).toBe('INVITATION_ALREADY_USED');
    });

    it('is refused when the email already has an account, leaving the invitation open', async () => {
      const owner = await signUp(ctx);
      const existing = await signUp(ctx);
      const { token } = await invite(owner, existing.email);

      expect(errorCode((await registerWith(token).expect(409)).body)).toBe('EMAIL_UNAVAILABLE');
      await preview(token).expect(200);
    });

    it('validates the new password', async () => {
      const owner = await signUp(ctx);
      const { token } = await invite(owner, newAccount().email);

      const response = await ctx
        .client()
        .post('/api/v1/invitations/register')
        .send({ token, displayName: 'Short', password: 'short' })
        .expect(400);
      expect((response.body as ApiErrorResponse).error.details?.[0]?.path).toBe('password');
    });
  });

  describe('accepting as a signed-in user', () => {
    it('adds the membership with the invited role', async () => {
      const owner = await signUp(ctx, { organizationName: 'Second Home' });
      const invitee = await signUp(ctx);
      const { token } = await invite(owner, invitee.email, 'VIEWER');

      const response = await invitee.client
        .post('/api/v1/invitations/accept')
        .send({ token })
        .expect(200);

      expect(response.body).toMatchObject({
        organization: { id: owner.organizationId, name: 'Second Home' },
        role: 'VIEWER',
      });
      const me = (await invitee.client.get('/api/v1/auth/me').expect(200)).body as MeResponse;
      expect(me.memberships.map((m) => m.organization.id)).toEqual([
        invitee.organizationId,
        owner.organizationId,
      ]);
      await invitee.client.get(`/api/v1/organizations/${owner.organizationId}`).expect(200);
    });

    it('requires a session', async () => {
      const owner = await signUp(ctx);
      const { token } = await invite(owner, newAccount().email);

      const response = await ctx
        .client()
        .post('/api/v1/invitations/accept')
        .send({ token })
        .expect(401);

      expect(errorCode(response.body)).toBe('AUTHENTICATION_REQUIRED');
    });

    it('is refused for a different email, leaving the invitation open', async () => {
      const owner = await signUp(ctx);
      const someoneElse = await signUp(ctx);
      const { token } = await invite(owner, newAccount().email);

      const response = await someoneElse.client
        .post('/api/v1/invitations/accept')
        .send({ token })
        .expect(403);

      expect(errorCode(response.body)).toBe('INVITATION_EMAIL_MISMATCH');
      await preview(token).expect(200);
      await someoneElse.client.get(`/api/v1/organizations/${owner.organizationId}`).expect(404);
    });

    it('lets only one of two simultaneous attempts use the link', async () => {
      const owner = await signUp(ctx);
      const invitee = await signUp(ctx);
      const secondSession = ctx.client();
      await secondSession
        .post('/api/v1/auth/login')
        .send({ email: invitee.email, password: invitee.password })
        .expect(200);
      const { token } = await invite(owner, invitee.email);

      const results = await Promise.all([
        invitee.client.post('/api/v1/invitations/accept').send({ token }),
        secondSession.post('/api/v1/invitations/accept').send({ token }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
      const { rows } = await ctx.db.pool.query(
        "SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
        [owner.organizationId, invitee.userId],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('revocation', () => {
    it('cancels the link and removes it from the list', async () => {
      const owner = await signUp(ctx);
      const { token, invitation } = await invite(owner, newAccount().email);
      const path = `/api/v1/organizations/${owner.organizationId}/invitations`;

      await owner.client.delete(`${path}/${invitation.id}`).expect(204);
      await owner.client.delete(`${path}/${invitation.id}`).expect(204);

      expect(errorCode((await preview(token).expect(410)).body)).toBe('INVITATION_REVOKED');
      expect(errorCode((await registerWith(token).expect(410)).body)).toBe('INVITATION_REVOKED');
      const list = (await owner.client.get(path).expect(200)).body as InvitationsResponse;
      expect(list.invitations).toEqual([]);
      const audit = await ctx.db.pool.query(
        "SELECT 1 FROM audit_events WHERE action = 'INVITATION_REVOKED' AND resource_id = $1",
        [invitation.id],
      );
      expect(audit.rows).toHaveLength(1);
    });

    it('cannot cancel an invitation that was already accepted', async () => {
      const owner = await signUp(ctx);
      const { token, invitation } = await invite(owner, newAccount().email);
      await registerWith(token).expect(201);

      const response = await owner.client
        .delete(`/api/v1/organizations/${owner.organizationId}/invitations/${invitation.id}`)
        .expect(410);
      expect(errorCode(response.body)).toBe('INVITATION_ALREADY_USED');
    });
  });

  describe('tenant isolation', () => {
    it('keeps the invitations of B away from the owner of A', async () => {
      const a = await signUp(ctx);
      const b = await signUp(ctx);
      const { invitation } = await invite(b, newAccount().email);
      const bPath = `/api/v1/organizations/${b.organizationId}/invitations`;

      await a.client.get(bPath).expect(404);
      await a.client.post(bPath).send({ email: newAccount().email, role: 'OWNER' }).expect(404);
      await a.client.delete(`${bPath}/${invitation.id}`).expect(404);
      const throughA = await a.client
        .delete(`/api/v1/organizations/${a.organizationId}/invitations/${invitation.id}`)
        .expect(404);

      expect(errorCode(throughA.body)).toBe('INVITATION_NOT_FOUND');
      const { rows } = await ctx.db.pool.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM invitations WHERE id = $1',
        [invitation.id],
      );
      expect(rows[0]?.revoked_at).toBeNull();
    });
  });

  it('counts created and accepted invitations in the metrics', async () => {
    const owner = await signUp(ctx);
    const { token } = await invite(owner, newAccount().email);
    await registerWith(token).expect(201);

    const metrics = (await ctx.client().get('/metrics').expect(200)).text;

    expect(metrics).toMatch(/^verarag_invitations_created_total [1-9]/m);
    expect(metrics).toMatch(/^verarag_invitations_accepted_total\{account="new"\} [1-9]/m);
    expect(metrics).not.toContain(token);
  });
});
