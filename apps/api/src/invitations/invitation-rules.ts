import type { InvitationStatus } from '@verarag/contracts';

import { AppError } from '../common/app-error.js';

interface InvitationState {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** Expiry is derived from the clock, so it is never stored as a status. */
export function invitationStatus(invitation: InvitationState, now: Date): InvitationStatus {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  return invitation.expiresAt <= now ? 'expired' : 'pending';
}

/** An invitation can be used once, before it expires, and only if nobody cancelled it. */
export function assertUsable(invitation: InvitationState, now: Date): void {
  switch (invitationStatus(invitation, now)) {
    case 'accepted':
      throw new AppError('INVITATION_ALREADY_USED');
    case 'revoked':
      throw new AppError('INVITATION_REVOKED');
    case 'expired':
      throw new AppError('INVITATION_EXPIRED');
    case 'pending':
      return;
  }
}
