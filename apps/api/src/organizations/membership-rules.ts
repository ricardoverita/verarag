import { AppError } from '../common/app-error.js';
import type { Role } from './roles.js';

/**
 * Who may give which role:
 * - OWNER may change anyone's role, including to and from OWNER.
 * - ADMIN may change roles among ADMIN, MEMBER and VIEWER, never touching owners.
 * - MEMBER and VIEWER may not change roles.
 */
export function assertCanChangeRole(actor: Role, current: Role, next: Role): void {
  if (actor === 'OWNER') return;
  if (actor === 'ADMIN' && current !== 'OWNER' && next !== 'OWNER') return;
  throw new AppError('INSUFFICIENT_ROLE');
}

/**
 * Inviting someone gives them a role, so it follows the same rule: only
 * owners may invite new owners, and members and viewers may not invite.
 * Cancelling an invitation follows it too.
 */
export function assertCanInvite(actor: Role, role: Role): void {
  if (actor === 'OWNER') return;
  if (actor === 'ADMIN' && role !== 'OWNER') return;
  throw new AppError('INSUFFICIENT_ROLE');
}

/**
 * Anyone may leave an organization. Removing someone else follows the same
 * rule as changing their role: admins cannot remove owners.
 */
export function assertCanRemoveMember(
  actor: { membershipId: string; role: Role },
  target: { membershipId: string; role: Role },
): void {
  if (actor.membershipId === target.membershipId) return;
  if (actor.role === 'OWNER') return;
  if (actor.role === 'ADMIN' && target.role !== 'OWNER') return;
  throw new AppError('INSUFFICIENT_ROLE');
}

/**
 * An organization always keeps at least one owner. `owners` is the number of
 * active owners right now; the change being checked removes `target` from
 * that set unless it stays an owner.
 */
export function assertOwnerRemains(owners: number, target: Role, next: Role | 'removed'): void {
  if (target === 'OWNER' && next !== 'OWNER' && owners <= 1) {
    throw new AppError('LAST_OWNER');
  }
}
