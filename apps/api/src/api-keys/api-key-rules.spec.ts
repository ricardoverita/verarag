import { describe, expect, it } from 'vitest';

import { AppError } from '../common/app-error.js';
import { apiKeyStatus, assertApiKeyActive } from './api-key-rules.js';

const now = new Date('2026-10-10T12:00:00Z');
const earlier = new Date('2026-10-09T12:00:00Z');
const later = new Date('2026-10-11T12:00:00Z');

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'unexpected';
  }
}

describe('apiKeyStatus', () => {
  it('is active until revoked or expired', () => {
    expect(apiKeyStatus({ expiresAt: null, revokedAt: null }, now)).toBe('active');
    expect(apiKeyStatus({ expiresAt: later, revokedAt: null }, now)).toBe('active');
    expect(apiKeyStatus({ expiresAt: earlier, revokedAt: null }, now)).toBe('expired');
    expect(apiKeyStatus({ expiresAt: now, revokedAt: null }, now)).toBe('expired');
  });

  it('reports revocation over expiry', () => {
    expect(apiKeyStatus({ expiresAt: earlier, revokedAt: earlier }, now)).toBe('revoked');
  });
});

describe('assertApiKeyActive', () => {
  it('fails with the reason the key cannot be used', () => {
    expect(codeOf(() => assertApiKeyActive({ expiresAt: null, revokedAt: null }, now))).toBe(
      undefined,
    );
    expect(codeOf(() => assertApiKeyActive({ expiresAt: null, revokedAt: earlier }, now))).toBe(
      'API_KEY_REVOKED',
    );
    expect(codeOf(() => assertApiKeyActive({ expiresAt: earlier, revokedAt: null }, now))).toBe(
      'API_KEY_EXPIRED',
    );
  });
});
