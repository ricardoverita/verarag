import type { ApiKeyStatus } from '@verarag/contracts';

import { AppError } from '../common/app-error.js';

interface ApiKeyState {
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export function apiKeyStatus(apiKey: ApiKeyState, now: Date): ApiKeyStatus {
  if (apiKey.revokedAt) return 'revoked';
  if (apiKey.expiresAt && apiKey.expiresAt <= now) return 'expired';
  return 'active';
}

export function assertApiKeyActive(apiKey: ApiKeyState, now: Date): void {
  switch (apiKeyStatus(apiKey, now)) {
    case 'revoked':
      throw new AppError('API_KEY_REVOKED');
    case 'expired':
      throw new AppError('API_KEY_EXPIRED');
    case 'active':
      return;
  }
}
