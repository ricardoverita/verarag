import { Injectable } from '@nestjs/common';
import type { ApiKeyScope } from '@verarag/contracts';

import type { Queryable } from '../database/database.js';

export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdBy: { id: string; displayName: string };
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** What authentication needs, including the hash to compare against. */
export interface ApiKeyCredential {
  id: string;
  organizationId: string;
  keyHash: Buffer;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

interface ApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  created_by_user_id: string;
  creator_display_name: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

const COLUMNS = `k.id, k.organization_id, k.name, k.prefix, k.scopes, k.created_by_user_id,
  creator.display_name AS creator_display_name,
  k.created_at, k.expires_at, k.last_used_at, k.revoked_at`;

/** Minimum time between two updates of last_used_at for the same key. */
export const API_KEY_TOUCH_INTERVAL_MS = 5 * 60_000;

/**
 * Management queries are scoped by organization. The lookup by prefix is
 * the exception: it is how a request carrying a key finds out which
 * organization the key belongs to.
 */
@Injectable()
export class ApiKeysRepository {
  async insert(
    db: Queryable,
    input: {
      organizationId: string;
      name: string;
      prefix: string;
      keyHash: Buffer;
      scopes: ApiKeyScope[];
      createdByUserId: string;
      expiresAt: Date | null;
    },
  ): Promise<ApiKeyRecord> {
    const { rows } = await db.query<ApiKeyRow>(
      `WITH k AS (
         INSERT INTO api_keys (organization_id, name, prefix, key_hash, scopes, created_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *
       )
       SELECT ${COLUMNS} FROM k JOIN users creator ON creator.id = k.created_by_user_id`,
      [
        input.organizationId,
        input.name,
        input.prefix,
        input.keyHash,
        input.scopes,
        input.createdByUserId,
        input.expiresAt,
      ],
    );
    return toRecord(rows[0]!);
  }

  /** Every key of the organization, newest first, revoked ones included. */
  async list(db: Queryable, organizationId: string): Promise<ApiKeyRecord[]> {
    const { rows } = await db.query<ApiKeyRow>(
      `SELECT ${COLUMNS}
       FROM api_keys k JOIN users creator ON creator.id = k.created_by_user_id
       WHERE k.organization_id = $1
       ORDER BY k.created_at DESC`,
      [organizationId],
    );
    return rows.map(toRecord);
  }

  async findByIdForUpdate(
    db: Queryable,
    key: { id: string; organizationId: string },
  ): Promise<ApiKeyRecord | undefined> {
    const { rows } = await db.query<ApiKeyRow>(
      `SELECT ${COLUMNS}
       FROM api_keys k JOIN users creator ON creator.id = k.created_by_user_id
       WHERE k.id = $1 AND k.organization_id = $2
       FOR UPDATE OF k`,
      [key.id, key.organizationId],
    );
    return rows[0] && toRecord(rows[0]);
  }

  async findCredentialByPrefix(
    db: Queryable,
    prefix: string,
  ): Promise<ApiKeyCredential | undefined> {
    const { rows } = await db.query<{
      id: string;
      organization_id: string;
      key_hash: Buffer;
      scopes: ApiKeyScope[];
      expires_at: Date | null;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, organization_id, key_hash, scopes, expires_at, last_used_at, revoked_at
       FROM api_keys WHERE prefix = $1`,
      [prefix],
    );
    const row = rows[0];
    return (
      row && {
        id: row.id,
        organizationId: row.organization_id,
        keyHash: row.key_hash,
        scopes: row.scopes,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
      }
    );
  }

  async revoke(db: Queryable, key: { id: string; organizationId: string }): Promise<void> {
    await db.query(
      'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND organization_id = $2',
      [key.id, key.organizationId],
    );
  }

  async touch(db: Queryable, id: string): Promise<void> {
    await db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [id]);
  }
}

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    createdBy: { id: row.created_by_user_id, displayName: row.creator_display_name },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
