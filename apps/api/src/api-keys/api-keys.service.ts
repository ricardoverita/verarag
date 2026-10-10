import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { ApiKeyScope } from '@verarag/contracts';

import { AuditLog } from '../audit/audit-log.js';
import type { ApiKeyPrincipal } from '../auth/principal.js';
import { AppError } from '../common/app-error.js';
import { hashToken } from '../common/tokens.js';
import { Database } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { OrganizationAccess } from '../organizations/organization-access.js';
import { assertApiKeyActive } from './api-key-rules.js';
import { apiKeyPrefix, generateApiKey } from './api-key-token.js';
import {
  API_KEY_TOUCH_INTERVAL_MS,
  type ApiKeyRecord,
  ApiKeysRepository,
} from './api-keys.repository.js';

export interface CreatedApiKey {
  apiKey: ApiKeyRecord;
  /** The only time the full key exists outside the caller's hands. */
  key: string;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly db: Database,
    private readonly apiKeys: ApiKeysRepository,
    private readonly audit: AuditLog,
    private readonly metrics: MetricsService,
  ) {}

  async create(
    access: OrganizationAccess,
    input: { name: string; scopes: ApiKeyScope[]; expiresInDays?: number },
    requestId?: string,
  ): Promise<CreatedApiKey> {
    const { key, prefix, hash } = generateApiKey();
    const expiresAt =
      input.expiresInDays === undefined
        ? null
        : new Date(Date.now() + input.expiresInDays * 24 * 3_600_000);

    const apiKey = await this.db.transaction(async (tx) => {
      const created = await this.apiKeys.insert(tx, {
        organizationId: access.organizationId,
        name: input.name,
        prefix,
        keyHash: hash,
        scopes: input.scopes,
        createdByUserId: access.userId,
        expiresAt,
      });
      await this.audit.record(tx, {
        action: 'API_KEY_CREATED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'api_key',
        resourceId: created.id,
        // The prefix is public; the key itself never goes anywhere but the response.
        metadata: { prefix, scopes: input.scopes.join(' '), requestId: requestId ?? null },
      });
      return created;
    });
    this.metrics.apiKeysCreated.inc();
    return { apiKey, key };
  }

  list(access: OrganizationAccess): Promise<ApiKeyRecord[]> {
    return this.apiKeys.list(this.db, access.organizationId);
  }

  /** Revokes a key for good. Revoking it again does nothing. */
  async revoke(access: OrganizationAccess, apiKeyId: string, requestId?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const apiKey = await this.apiKeys.findByIdForUpdate(tx, {
        id: apiKeyId,
        organizationId: access.organizationId,
      });
      if (!apiKey) {
        throw new AppError('API_KEY_NOT_FOUND');
      }
      if (apiKey.revokedAt) return;

      await this.apiKeys.revoke(tx, apiKey);
      await this.audit.record(tx, {
        action: 'API_KEY_REVOKED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'api_key',
        resourceId: apiKey.id,
        metadata: { prefix: apiKey.prefix, requestId: requestId ?? null },
      });
    });
  }

  /**
   * Resolves a bearer key into a principal. Malformed and unknown keys fail
   * the same way; only someone holding the real key learns that it was
   * revoked or has expired.
   */
  async authenticate(key: string): Promise<ApiKeyPrincipal> {
    const prefix = apiKeyPrefix(key);
    const credential = prefix && (await this.apiKeys.findCredentialByPrefix(this.db, prefix));
    if (!credential || !timingSafeEqual(credential.keyHash, hashToken(key))) {
      this.metrics.apiKeysRejected.inc({ reason: 'invalid' });
      throw new AppError('INVALID_API_KEY');
    }
    try {
      assertApiKeyActive(credential, new Date());
    } catch (error) {
      this.metrics.apiKeysRejected.inc({
        reason: credential.revokedAt ? 'revoked' : 'expired',
      });
      throw error;
    }

    const lastUsed = credential.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsed > API_KEY_TOUCH_INTERVAL_MS) {
      await this.apiKeys.touch(this.db, credential.id);
    }
    return {
      kind: 'apiKey',
      apiKeyId: credential.id,
      organizationId: credential.organizationId,
      scopes: credential.scopes,
    };
  }
}
