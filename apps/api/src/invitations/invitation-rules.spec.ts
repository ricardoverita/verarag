import { describe, expect, it } from 'vitest';

import { AppError } from '../common/app-error.js';
import { assertUsable, invitationStatus } from './invitation-rules.js';

const now = new Date('2026-10-09T12:00:00Z');
const later = new Date('2026-10-10T12:00:00Z');
const earlier = new Date('2026-10-08T12:00:00Z');

const pending = { expiresAt: later, acceptedAt: null, revokedAt: null };

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'unexpected';
  }
}

describe('invitationStatus', () => {
  it('is pending until it expires', () => {
    expect(invitationStatus(pending, now)).toBe('pending');
    expect(invitationStatus({ ...pending, expiresAt: earlier }, now)).toBe('expired');
    expect(invitationStatus({ ...pending, expiresAt: now }, now)).toBe('expired');
  });

  it('reports the outcome even after the expiry date', () => {
    expect(invitationStatus({ ...pending, expiresAt: earlier, acceptedAt: earlier }, now)).toBe(
      'accepted',
    );
    expect(invitationStatus({ ...pending, expiresAt: earlier, revokedAt: earlier }, now)).toBe(
      'revoked',
    );
  });
});

describe('assertUsable', () => {
  it('accepts only pending invitations', () => {
    expect(codeOf(() => assertUsable(pending, now))).toBeUndefined();
    expect(codeOf(() => assertUsable({ ...pending, acceptedAt: earlier }, now))).toBe(
      'INVITATION_ALREADY_USED',
    );
    expect(codeOf(() => assertUsable({ ...pending, revokedAt: earlier }, now))).toBe(
      'INVITATION_REVOKED',
    );
    expect(codeOf(() => assertUsable({ ...pending, expiresAt: earlier }, now))).toBe(
      'INVITATION_EXPIRED',
    );
  });
});
