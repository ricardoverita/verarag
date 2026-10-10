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
