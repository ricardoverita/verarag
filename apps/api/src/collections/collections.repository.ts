import { Injectable } from '@nestjs/common';
import type { ActorView } from '@verarag/contracts';

import { type Actor, actorColumns, type ActorRow, actorSql, toActorView } from '../common/actor.js';
import type { Queryable } from '../database/database.js';

export interface CollectionRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  documentCount: number;
  createdBy: ActorView;
  createdAt: Date;
  updatedAt: Date;
}

interface CollectionRow extends ActorRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  document_count: number;
  created_at: Date;
  updated_at: Date;
}

const actor = actorSql('c');
const COLUMNS = `c.id, c.organization_id, c.name, c.description, c.created_at, c.updated_at,
  ${actor.columns},
  (SELECT count(*)::int FROM documents d
   WHERE d.collection_id = c.id AND d.deleted_at IS NULL) AS document_count`;

export type CollectionKey = { id: string; organizationId: string };

/**
 * Every query takes the organization: a collection id from another
 * organization is simply not found. Deleted collections are never returned.
 */
@Injectable()
export class CollectionsRepository {
  async insert(
    db: Queryable,
    input: { organizationId: string; name: string; description: string | null; actor: Actor },
  ): Promise<CollectionRecord> {
    const createdBy = actorColumns(input.actor);
    const { rows } = await db.query<CollectionRow>(
      `WITH c AS (
         INSERT INTO collections (organization_id, name, description, created_by_user_id, created_by_api_key_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *
       )
       SELECT ${COLUMNS} FROM c ${actor.joins}`,
      [input.organizationId, input.name, input.description, createdBy.userId, createdBy.apiKeyId],
    );
    return toRecord(rows[0]!);
  }

  /** Live collections of the organization, by name. */
  async list(db: Queryable, organizationId: string): Promise<CollectionRecord[]> {
    const { rows } = await db.query<CollectionRow>(
      `SELECT ${COLUMNS} FROM collections c ${actor.joins}
       WHERE c.organization_id = $1 AND c.deleted_at IS NULL
       ORDER BY lower(c.name), c.id`,
      [organizationId],
    );
    return rows.map(toRecord);
  }

  /**
   * A live collection. `lock: 'share'` keeps it from being deleted until the
   * transaction ends, which is what adding a document to it needs;
   * `lock: 'update'` is for changing or deleting it.
   */
  async find(
    db: Queryable,
    key: CollectionKey,
    options: { lock?: 'share' | 'update' } = {},
  ): Promise<CollectionRecord | undefined> {
    const lock =
      options.lock === 'update'
        ? 'FOR UPDATE OF c'
        : options.lock === 'share'
          ? 'FOR SHARE OF c'
          : '';
    const { rows } = await db.query<CollectionRow>(
      `SELECT ${COLUMNS} FROM collections c ${actor.joins}
       WHERE c.id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL
       ${lock}`,
      [key.id, key.organizationId],
    );
    return rows[0] && toRecord(rows[0]);
  }

  async update(
    db: Queryable,
    key: CollectionKey,
    changes: { name?: string; description?: string | null },
  ): Promise<void> {
    await db.query(
      `UPDATE collections SET
         name = CASE WHEN $3 THEN $4 ELSE name END,
         description = CASE WHEN $5 THEN $6 ELSE description END
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [
        key.id,
        key.organizationId,
        changes.name !== undefined,
        changes.name ?? null,
        changes.description !== undefined,
        changes.description ?? null,
      ],
    );
  }

  /** Whether any document of the collection is not deleted yet, whatever its status. */
  async hasDocuments(db: Queryable, key: CollectionKey): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1 FROM documents
       WHERE collection_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [key.id, key.organizationId],
    );
    return rows.length > 0;
  }

  async softDelete(db: Queryable, key: CollectionKey): Promise<void> {
    await db.query(
      'UPDATE collections SET deleted_at = now() WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
      [key.id, key.organizationId],
    );
  }

  async count(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*) FROM collections WHERE deleted_at IS NULL',
    );
    return Number(rows[0]?.count ?? 0);
  }
}

function toRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    documentCount: row.document_count,
    createdBy: toActorView(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
