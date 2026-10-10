/**
 * HTTP payloads for organization API keys. A key is sent as
 * `Authorization: Bearer vrg_…` and only works on routes that accept its scopes.
 */
export type ApiKeyScope = 'system:read';

export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

/** A key as listed to owners and admins. Never the key itself. */
export interface ApiKeyView {
  id: string;
  name: string;
  /** Public start of the key, like `vrg_3f9a1c0b7d2e`, to tell keys apart. */
  prefix: string;
  scopes: ApiKeyScope[];
  status: ApiKeyStatus;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  /** Defaults to `['system:read']`. */
  scopes?: ApiKeyScope[];
  /** Days until the key expires. Without it, the key works until it is revoked. */
  expiresInDays?: number;
}

/** The full key is returned only here, once. */
export interface CreatedApiKeyResponse {
  apiKey: ApiKeyView;
  key: string;
}

export interface ApiKeysResponse {
  apiKeys: ApiKeyView[];
}
