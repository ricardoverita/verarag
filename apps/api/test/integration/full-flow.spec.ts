import type {
  ApiKeysResponse,
  CreatedApiKeyResponse,
  CreatedInvitationResponse,
  MeResponse,
  MembersResponse,
  MembershipSummary,
  RegisterResponse,
} from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type IntegrationContext,
  newAccount,
  startIntegrationApp,
} from '../support/integration.js';

/**
 * The Phase 1 definition of done, end to end over HTTP and against a real
 * PostgreSQL: one person creates organizations and invites another, who
 * joins; API keys are created and revoked; an unrelated tenant sees nothing.
 */
describe('full flow', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('goes from sign-up to a shared organization with API keys, isolated from other tenants', async () => {
    // 1. Ana registers, which creates her first organization.
    const ana = ctx.client();
    const anaAccount = newAccount({ displayName: 'Ana', organizationName: 'Ana Labs' });
    const registered = (await ana.post('/api/v1/auth/register').send(anaAccount).expect(201))
      .body as RegisterResponse;
    const labs = registered.organization.id;

    // 2. She creates a second organization.
    const research = (
      (await ana.post('/api/v1/organizations').send({ name: 'Ana Research' }).expect(201))
        .body as MembershipSummary
    ).organization.id;

    // 3. She signs out, and the old session stops working; then she signs in again.
    await ana.post('/api/v1/auth/logout').expect(204);
    await ana.get('/api/v1/auth/me').expect(401);
    const me = (
      await ana
        .post('/api/v1/auth/login')
        .send({ email: anaAccount.email, password: anaAccount.password })
        .expect(200)
    ).body as MeResponse;
    expect(me.memberships.map((m) => m.organization.name)).toEqual(['Ana Labs', 'Ana Research']);

    // 4. She invites Bruno to Ana Labs as a member.
    const brunoAccount = newAccount({ displayName: 'Bruno' });
    const invitation = (
      await ana
        .post(`/api/v1/organizations/${labs}/invitations`)
        .send({ email: brunoAccount.email, role: 'MEMBER' })
        .expect(201)
    ).body as CreatedInvitationResponse;
    const token = new URL(invitation.inviteUrl).pathname.split('/').pop()!;

    // 5. Bruno opens the link and joins by creating his account.
    const bruno = ctx.client();
    const preview = await bruno.post('/api/v1/invitations/preview').send({ token }).expect(200);
    expect(preview.body).toMatchObject({ organization: { name: 'Ana Labs' }, role: 'MEMBER' });
    await bruno
      .post('/api/v1/invitations/register')
      .send({ token, displayName: 'Bruno', password: brunoAccount.password })
      .expect(201);

    // 6. Bruno belongs to Ana Labs only, and sees its members.
    const brunoMe = (await bruno.get('/api/v1/auth/me').expect(200)).body as MeResponse;
    expect(brunoMe.memberships.map((m) => [m.organization.name, m.role])).toEqual([
      ['Ana Labs', 'MEMBER'],
    ]);
    const members = (await bruno.get(`/api/v1/organizations/${labs}/members`).expect(200))
      .body as MembersResponse;
    expect(members.members.map((m) => [m.user.displayName, m.role])).toEqual([
      ['Ana', 'OWNER'],
      ['Bruno', 'MEMBER'],
    ]);
    await bruno.get(`/api/v1/organizations/${research}`).expect(404);

    // 7. Ana switches between her organizations: each one answers with her role.
    for (const organizationId of [labs, research]) {
      const detail = await ana.get(`/api/v1/organizations/${organizationId}`).expect(200);
      expect(detail.body).toMatchObject({ organization: { id: organizationId }, role: 'OWNER' });
    }

    // 8. Ana creates an API key in Ana Labs, uses it, and revokes it.
    const created = (
      await ana
        .post(`/api/v1/organizations/${labs}/api-keys`)
        .send({ name: 'Monitoring' })
        .expect(201)
    ).body as CreatedApiKeyResponse;
    const auth = { authorization: `Bearer ${created.key}` };
    await ctx.client().get('/api/v1/system/status').set(auth).expect(200);
    await bruno.post(`/api/v1/organizations/${labs}/api-keys`).send({ name: 'No' }).expect(403);
    await ana.delete(`/api/v1/organizations/${labs}/api-keys/${created.apiKey.id}`).expect(204);
    await ctx.client().get('/api/v1/system/status').set(auth).expect(401);

    // 9. Carla, in another tenant, cannot see or touch any of it.
    const carla = ctx.client();
    await carla.post('/api/v1/auth/register').send(newAccount()).expect(201);
    for (const path of [
      `/api/v1/organizations/${labs}`,
      `/api/v1/organizations/${labs}/members`,
      `/api/v1/organizations/${labs}/invitations`,
      `/api/v1/organizations/${labs}/api-keys`,
    ]) {
      await carla.get(path).expect(404);
    }
    await carla.patch(`/api/v1/organizations/${labs}`).send({ name: 'Mine' }).expect(404);
    await carla.post('/api/v1/invitations/accept').send({ token }).expect(410);
    const anaKeys = (await ana.get(`/api/v1/organizations/${labs}/api-keys`).expect(200))
      .body as ApiKeysResponse;
    expect(anaKeys.apiKeys.map((k) => k.status)).toEqual(['revoked']);
  });
});
