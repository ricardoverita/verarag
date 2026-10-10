import type {
  ApiKeyScope,
  ApiKeysResponse,
  ApiKeyView,
  CreatedApiKeyResponse,
} from '@verarag/contracts';
import { z } from 'zod';

import { apiKeyStatus } from './api-key-rules.js';
import type { ApiKeyRecord } from './api-keys.repository.js';

export const API_KEY_SCOPES = [
  'system:read',
  'collections:read',
  'collections:write',
  'documents:read',
  'documents:write',
] as const satisfies readonly ApiKeyScope[];

const scopeSchema = z.enum(API_KEY_SCOPES);

export const createApiKeyRequest = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(scopeSchema)
    .min(1)
    .transform((scopes) => [...new Set(scopes)])
    .default(['system:read']),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequest>;

export const apiKeyIdParam = z.uuid();

export const apiKeyView = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(scopeSchema),
  status: z.enum(['active', 'expired', 'revoked']),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<ApiKeyView>;

export const createdApiKeyResponse = z.object({
  apiKey: apiKeyView,
  key: z.string(),
}) satisfies z.ZodType<CreatedApiKeyResponse>;

export const apiKeysResponse = z.object({
  apiKeys: z.array(apiKeyView),
}) satisfies z.ZodType<ApiKeysResponse>;

export function toApiKeyView(apiKey: ApiKeyRecord, now = new Date()): ApiKeyView {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    status: apiKeyStatus(apiKey, now),
    createdBy: apiKey.createdBy,
    createdAt: apiKey.createdAt.toISOString(),
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
  };
}
