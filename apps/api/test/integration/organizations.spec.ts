import type {
  ApiErrorResponse,
  MembersResponse,
  MembershipSummary,
  OrganizationDetail,
} from '@verarag/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addMember, membershipId, type Person, signUp } from '../support/fixtures.js';
import { type IntegrationContext, startIntegrationApp } from '../support/integration.js';

const errorCode = (body: unknown) => (body as ApiErrorResponse).error.code;

describe('organizations and members', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await startIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** An organization with one person per role. */
  async function team() {
    const owner = await signUp(ctx, { organizationName: 'Team' });
    const org = owner.organizationId;
    const admin = await signUp(ctx);
    const member = await signUp(ctx);
    const viewer = await signUp(ctx);
    const ids = {
      owner: await membershipId(ctx, org, owner),
      admin: await addMember(ctx, org, admin, 'ADMIN'),
      member: await addMember(ctx, org, member, 'MEMBER'),
      viewer: await addMember(ctx, org, viewer, 'VIEWER'),
    };
    return { org, owner, admin, member, viewer, ids };
  }

  const setRole = (person: Person, org: string, id: string, role: string) =>
    person.client.patch(`/api/v1/organizations/${org}/members/${id}`).send({ role });

  describe('organizations', () => {
    it('creates more organizations with the caller as OWNER and lists only those', async () => {
      const person = await signUp(ctx, { organizationName: 'First' });

      const created = await person.client
        .post('/api/v1/organizations')
        .send({ name: 'Second Org' })
        .expect(201);
      const list = await person.client.get('/api/v1/organizations').expect(200);

      expect(created.body).toMatchObject({
        role: 'OWNER',
        organization: { name: 'Second Org', slug: 'second-org' },
      });
      const organizations = (list.body as { organizations: MembershipSummary[] }).organizations;
      expect(organizations.map((item) => item.organization.name)).toEqual(['First', 'Second Org']);
    });

    it('shows an organization to its members with their role and the member count', async () => {
      const { org, viewer } = await team();

      const response = await viewer.client.get(`/api/v1/organizations/${org}`).expect(200);

      expect(response.body).toMatchObject({
        organization: { id: org, name: 'Team' },
        role: 'VIEWER',
        memberCount: 4,
      });
    });

    it('lets owners and admins rename it, and nobody else', async () => {
      const { org, owner, admin, member, viewer } = await team();
      const rename = (person: Person, name: string) =>
        person.client.patch(`/api/v1/organizations/${org}`).send({ name });
      const before = await owner.client.get(`/api/v1/organizations/${org}`).expect(200);

      await rename(owner, 'Renamed by owner').expect(200);
      const byAdmin = await rename(admin, 'Renamed by admin').expect(200);
      // Renaming keeps the slug, so links to the organization stay valid.
      expect((byAdmin.body as OrganizationDetail).organization).toMatchObject({
        name: 'Renamed by admin',
        slug: (before.body as OrganizationDetail).organization.slug,
      });

      for (const person of [member, viewer]) {
        const response = await rename(person, 'Not allowed').expect(403);
        expect(errorCode(response.body)).toBe('INSUFFICIENT_ROLE');
      }
    });

    it('are counted in the metrics without naming any of them', async () => {
      await signUp(ctx, { organizationName: 'Metric Org' });

      const metrics = (await ctx.client().get('/metrics').expect(200)).text;

      expect(metrics).toMatch(/^verarag_organizations [1-9]/m);
      expect(metrics).not.toContain('Metric Org');
      expect(metrics).not.toContain('metric-org');
    });
  });

  describe('members', () => {
    it('are visible to every member, including viewers', async () => {
      const { org, viewer, owner } = await team();

      const response = await viewer.client.get(`/api/v1/organizations/${org}/members`).expect(200);
      const { members } = response.body as MembersResponse;

      expect(members.map((m) => m.role)).toEqual(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
      expect(members[0]?.user.email).toBe(owner.email);
      expect(JSON.stringify(members)).not.toMatch(/password|argon2/i);
    });

    it('follow the role rules when roles change', async () => {
      const { org, owner, admin, member, ids } = await team();

      await setRole(admin, org, ids.member, 'ADMIN').expect(204);
      // The promoted member now acts as an ADMIN.
      expect(errorCode((await setRole(admin, org, ids.viewer, 'OWNER').expect(403)).body)).toBe(
        'INSUFFICIENT_ROLE',
      );
      expect(errorCode((await setRole(admin, org, ids.owner, 'MEMBER').expect(403)).body)).toBe(
        'INSUFFICIENT_ROLE',
      );
      await setRole(member, org, ids.viewer, 'MEMBER').expect(204);
      await setRole(owner, org, ids.viewer, 'OWNER').expect(204);

      const { rows } = await ctx.db.pool.query<{ action: string; metadata: unknown }>(
        "SELECT action, metadata FROM audit_events WHERE organization_id = $1 AND action = 'MEMBER_ROLE_CHANGED' ORDER BY created_at",
        [org],
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.metadata)).toMatchObject([
        { from: 'MEMBER', to: 'ADMIN' },
        { from: 'VIEWER', to: 'MEMBER' },
        { from: 'MEMBER', to: 'OWNER' },
      ]);
    });

    it('cannot change roles as a plain member or viewer', async () => {
      const { org, member, viewer, ids } = await team();

      await setRole(member, org, ids.viewer, 'ADMIN').expect(403);
      await setRole(viewer, org, ids.member, 'VIEWER').expect(403);
    });

    it('can leave, and lose access when they do', async () => {
      const { org, member, ids } = await team();

      await member.client.delete(`/api/v1/organizations/${org}/members/${ids.member}`).expect(204);

      const response = await member.client.get(`/api/v1/organizations/${org}`).expect(404);
      expect(errorCode(response.body)).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('can be removed by admins, but admins cannot remove owners', async () => {
      const { org, admin, ids } = await team();

      await admin.client.delete(`/api/v1/organizations/${org}/members/${ids.viewer}`).expect(204);
      await admin.client.delete(`/api/v1/organizations/${org}/members/${ids.owner}`).expect(403);
    });

    it('are reported as missing when the id is unknown or malformed', async () => {
      const { org, owner } = await team();

      const unknown = await setRole(owner, org, '0199a7d2-0000-7000-8000-000000000000', 'ADMIN');
      expect(unknown.status).toBe(404);
      expect(errorCode(unknown.body)).toBe('MEMBER_NOT_FOUND');
      await setRole(owner, org, 'not-a-uuid', 'ADMIN').expect(400);
    });
  });

  describe('owner safety', () => {
    it('refuses to let the last owner demote themselves or leave', async () => {
      const owner = await signUp(ctx);
      const org = owner.organizationId;
      const id = await membershipId(ctx, org, owner);

      const demote = await setRole(owner, org, id, 'ADMIN').expect(409);
      const leave = await owner.client
        .delete(`/api/v1/organizations/${org}/members/${id}`)
        .expect(409);

      expect(errorCode(demote.body)).toBe('LAST_OWNER');
      expect(errorCode(leave.body)).toBe('LAST_OWNER');
    });

    it('lets an owner step down when another owner remains', async () => {
      const owner = await signUp(ctx);
      const other = await signUp(ctx);
      const org = owner.organizationId;
      await addMember(ctx, org, other, 'OWNER');

      await setRole(owner, org, await membershipId(ctx, org, owner), 'ADMIN').expect(204);
    });

    it('keeps one owner when two owners demote each other at the same time', async () => {
      const first = await signUp(ctx);
      const second = await signUp(ctx);
      const org = first.organizationId;
      const firstId = await membershipId(ctx, org, first);
      const secondId = await addMember(ctx, org, second, 'OWNER');

      const results = await Promise.all([
        setRole(first, org, secondId, 'MEMBER'),
        setRole(second, org, firstId, 'MEMBER'),
      ]);

      // The loser gets 409 when it reaches the owner check, or 403 when the
      // winner's change committed before its role was even read.
      const [winner, loser] = results.map((r) => r.status).sort();
      expect(winner).toBe(204);
      expect([403, 409]).toContain(loser);
      const { rows } = await ctx.db.pool.query(
        "SELECT 1 FROM memberships WHERE organization_id = $1 AND role = 'OWNER' AND status = 'active'",
        [org],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
