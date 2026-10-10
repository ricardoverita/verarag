import type { MemberRole, MembershipSummary } from '@verarag/contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrganizationId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function pickMembership(
  memberships: MembershipSummary[],
  preferredId: string | undefined,
): MembershipSummary | null {
  return (
    memberships.find((membership) => membership.organization.id === preferredId) ??
    memberships[0] ??
    null
  );
}

/** Owners and admins manage the organization: settings, invitations and API keys. */
export function canManage(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

const ALL_ROLES: MemberRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

/**
 * Roles the actor may give to a member who has `target` now, mirroring the
 * API's rules so the page does not offer what would be refused. An empty
 * list means the role cannot be changed by this actor.
 */
export function assignableRoles(actor: MemberRole, target: MemberRole): MemberRole[] {
  if (actor === 'OWNER') return ALL_ROLES;
  if (actor === 'ADMIN' && target !== 'OWNER') return ['ADMIN', 'MEMBER', 'VIEWER'];
  return [];
}

/** Roles the actor may invite people with. */
export function invitableRoles(actor: MemberRole): MemberRole[] {
  return assignableRoles(actor, 'VIEWER');
}

/** Anyone may leave; owners remove anyone and admins remove everyone but owners. */
export function canRemove(actor: MemberRole, target: MemberRole, isSelf: boolean): boolean {
  return isSelf || actor === 'OWNER' || (actor === 'ADMIN' && target !== 'OWNER');
}
