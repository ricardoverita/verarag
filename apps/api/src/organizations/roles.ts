export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Basic roles for this phase. Fine-grained permissions (per collection or
 * document) belong to the enterprise permissions phase.
 *
 * - OWNER: everything, including managing other owners.
 * - ADMIN: manages members, invitations and API keys, but not owners.
 * - MEMBER: uses the organization.
 * - VIEWER: read-only access.
 */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
