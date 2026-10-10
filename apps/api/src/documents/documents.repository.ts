import { Injectable } from '@nestjs/common';
import type {
  ActorView,
  DocumentFailureReason,
  DocumentMediaType,
  DocumentStatus,
} from '@verarag/contracts';

import { type Actor, actorColumns, type ActorRow, actorSql, toActorView } from '../common/actor.js';
import type { Queryable } from '../database/database.js';

export type StorageStatus = DocumentStatus | 'DELETED';

export interface DocumentRecord {
  id: string;
  organizationId: string;
  collectionId: string;
  filename: string;
  mediaType: DocumentMediaType;
  sizeBytes: number | null;
  sha256: string | null;
  /** Internal: where the content is in object storage. Never sent to clients. */
  objectKey: string;
  status: StorageStatus;
  failureReason: DocumentFailureReason | null;
  createdBy: ActorView;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentRow extends ActorRow {
  id: string;
  organization_id: string;
  collection_id: string;
  original_filename: string;
  media_type: DocumentMediaType;
  size_bytes: string | null;
  sha256: string | null;
  object_key: string;
  storage_status: StorageStatus;
  failure_reason: DocumentFailureReason | null;
  created_at: Date;
  updated_at: Date;
}

const actor = actorSql('d');
const COLUMNS = `d.id, d.organization_id, d.collection_id, d.original_filename, d.media_type,
  d.size_bytes, d.sha256, d.object_key, d.storage_status, d.failure_reason,
  d.created_at, d.updated_at, ${actor.columns}`;

export type DocumentKey = { id: string; organizationId: string };

/**
 * Every query takes the organization, and status changes are
 * compare-and-set: an update names the status it expects to replace, so two
 * requests racing on the same document cannot both win.
 */
@Injectable()
export class DocumentsRepository {
  async insertUploading(
    db: Queryable,
    input: {
      organizationId: string;
      collectionId: string;
      filename: string;
      mediaType: DocumentMediaType;
      actor: Actor;
    },
  ): Promise<DocumentRecord> {
    const createdBy = actorColumns(input.actor);
    const { rows } = await db.query<DocumentRow>(
      `WITH d AS (
         INSERT INTO documents
           (organization_id, collection_id, original_filename, media_type,
            created_by_user_id, created_by_api_key_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *
       )
       SELECT ${COLUMNS} FROM d ${actor.joins}`,
      [
        input.organizationId,
        input.collectionId,
        input.filename,
        input.mediaType,
        createdBy.userId,
        createdBy.apiKeyId,
      ],
    );
    return toRecord(rows[0]!);
  }

  /** UPLOADING -> AVAILABLE. Undefined if the document left UPLOADING meanwhile. */
  async markAvailable(
    db: Queryable,
    key: DocumentKey,
    content: { sizeBytes: number; sha256: string },
  ): Promise<DocumentRecord | undefined> {
    const updated = await db.query(
      `UPDATE documents SET storage_status = 'AVAILABLE', size_bytes = $3, sha256 = $4
       WHERE id = $1 AND organization_id = $2 AND storage_status = 'UPLOADING'`,
      [key.id, key.organizationId, content.sizeBytes, content.sha256],
    );
    return updated.rowCount === 1 ? this.find(db, key) : undefined;
  }

  /** UPLOADING -> FAILED. */
  async markFailed(db: Queryable, key: DocumentKey, reason: DocumentFailureReason): Promise<void> {
    await db.query(
      `UPDATE documents SET storage_status = 'FAILED', failure_reason = $3
       WHERE id = $1 AND organization_id = $2 AND storage_status = 'UPLOADING'`,
      [key.id, key.organizationId, reason],
    );
  }

  /** Documents of a collection that are not deleted, newest first. */
  async listByCollection(
    db: Queryable,
    key: { collectionId: string; organizationId: string },
  ): Promise<DocumentRecord[]> {
    const { rows } = await db.query<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents d ${actor.joins}
       WHERE d.collection_id = $1 AND d.organization_id = $2 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC, d.id DESC`,
      [key.collectionId, key.organizationId],
    );
    return rows.map(toRecord);
  }

  /** A document that is not deleted. */
  async find(db: Queryable, key: DocumentKey): Promise<DocumentRecord | undefined> {
    const { rows } = await db.query<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents d ${actor.joins}
       WHERE d.id = $1 AND d.organization_id = $2 AND d.deleted_at IS NULL`,
      [key.id, key.organizationId],
    );
    return rows[0] && toRecord(rows[0]);
  }

  /** Documents per status, deleted ones excluded, for the metrics. */
  async countByStatus(db: Queryable): Promise<Map<DocumentStatus, number>> {
    const { rows } = await db.query<{ storage_status: DocumentStatus; count: string }>(
      `SELECT storage_status, count(*) FROM documents
       WHERE deleted_at IS NULL GROUP BY storage_status`,
    );
    return new Map(rows.map((row) => [row.storage_status, Number(row.count)]));
  }
}

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    collectionId: row.collection_id,
    filename: row.original_filename,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    sha256: row.sha256,
    objectKey: row.object_key,
    status: row.storage_status,
    failureReason: row.failure_reason,
    createdBy: toActorView(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
