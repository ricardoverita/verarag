import { Injectable } from '@nestjs/common';

import { AuditLog } from '../audit/audit-log.js';
import { type ActionContext, auditActor } from '../common/actor.js';
import { AppError } from '../common/app-error.js';
import { Database, isUniqueViolation, type Queryable } from '../database/database.js';
import { type CollectionRecord, CollectionsRepository } from './collections.repository.js';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly db: Database,
    private readonly collections: CollectionsRepository,
    private readonly audit: AuditLog,
  ) {}

  async create(
    context: ActionContext,
    input: { name: string; description: string | null },
  ): Promise<CollectionRecord> {
    return this.mapNameConflict(() =>
      this.db.transaction(async (tx) => {
        const collection = await this.collections.insert(tx, {
          organizationId: context.organizationId,
          name: input.name,
          description: input.description,
          actor: context.actor,
        });
        await this.record(tx, context, 'COLLECTION_CREATED', collection.id, {});
        return collection;
      }),
    );
  }

  list(organizationId: string): Promise<CollectionRecord[]> {
    return this.collections.list(this.db, organizationId);
  }

  async get(organizationId: string, id: string): Promise<CollectionRecord> {
    const collection = await this.collections.find(this.db, { id, organizationId });
    if (!collection) {
      throw new AppError('COLLECTION_NOT_FOUND');
    }
    return collection;
  }

  async update(
    context: ActionContext,
    id: string,
    changes: { name?: string; description?: string | null },
  ): Promise<CollectionRecord> {
    return this.mapNameConflict(() =>
      this.db.transaction(async (tx) => {
        const key = { id, organizationId: context.organizationId };
        if (!(await this.collections.find(tx, key, { lock: 'update' }))) {
          throw new AppError('COLLECTION_NOT_FOUND');
        }
        await this.collections.update(tx, key, changes);
        await this.record(tx, context, 'COLLECTION_UPDATED', id, {
          fields: Object.keys(changes).sort().join(' '),
        });
        return (await this.collections.find(tx, key))!;
      }),
    );
  }

  /**
   * Deletes a collection that has no documents left. Documents are never
   * deleted along with it: each one has to go through its own deletion,
   * which removes its stored file. The lock taken here serializes with
   * uploads, which hold a share lock on the collection while they add a row.
   */
  async delete(context: ActionContext, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const key = { id, organizationId: context.organizationId };
      if (!(await this.collections.find(tx, key, { lock: 'update' }))) {
        throw new AppError('COLLECTION_NOT_FOUND');
      }
      if (await this.collections.hasDocuments(tx, key)) {
        throw new AppError('COLLECTION_NOT_EMPTY');
      }
      await this.collections.softDelete(tx, key);
      await this.record(tx, context, 'COLLECTION_DELETED', id, {});
    });
  }

  private async mapNameConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error, 'collections_name_key')) {
        throw new AppError('COLLECTION_NAME_TAKEN');
      }
      throw error;
    }
  }

  private record(
    tx: Queryable,
    context: ActionContext,
    action: 'COLLECTION_CREATED' | 'COLLECTION_UPDATED' | 'COLLECTION_DELETED',
    collectionId: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    return this.audit.record(tx, {
      action,
      organizationId: context.organizationId,
      ...auditActor(context.actor),
      resourceType: 'collection',
      resourceId: collectionId,
      metadata: { ...metadata, requestId: context.requestId ?? null },
    });
  }
}
