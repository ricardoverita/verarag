import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import type { DocumentFailureReason } from '@verarag/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AuditLog } from '../audit/audit-log.js';
import { CollectionsRepository } from '../collections/collections.repository.js';
import { type ActionContext, auditActor } from '../common/actor.js';
import { AppError } from '../common/app-error.js';
import { CONFIG, type Config } from '../config/config.js';
import { Database } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import { ObjectStorage, StorageError, type StoredObject } from '../storage/object-storage.js';
import { inspectContent } from './content-inspector.js';
import {
  checkSignature,
  DocumentTooLargeError,
  DocumentTypeError,
  HEAD_BYTES,
  resolveDocumentType,
} from './document-types.js';
import { type DocumentRecord, DocumentsRepository } from './documents.repository.js';
import { sanitizeFilename } from './filename.js';
import { InvalidUploadError, peek, receiveFile } from './multipart.js';

/** Room for multipart boundaries and part headers around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: Database,
    private readonly documents: DocumentsRepository,
    private readonly collections: CollectionsRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditLog,
    private readonly metrics: MetricsService,
    @InjectPinoLogger(DocumentsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Stores one uploaded file, streaming it from the request to object
   * storage. The steps, in order:
   *
   * 1. Cheap refusals before reading the body: not multipart, a declared
   *    length over the limit, an unknown collection.
   * 2. The file's name and declared type, then its first bytes, are
   *    checked. Nothing is written yet.
   * 3. A row is inserted as UPLOADING, so the object about to be written
   *    always has a row that names it.
   * 4. The content streams to storage through the inspector, which counts
   *    bytes, enforces the limit, computes SHA-256 and validates it.
   * 5. The stored size is checked against the bytes sent, and the row
   *    becomes AVAILABLE with its size and checksum.
   *
   * Any failure after step 3 marks the row FAILED and removes whatever
   * reached storage, best effort. PostgreSQL and S3 cannot share a
   * transaction: a crash between 4 and 5 leaves an UPLOADING row and maybe
   * an object, which deleting the document cleans up.
   */
  async upload(
    context: ActionContext,
    collectionId: string,
    request: IncomingMessage,
  ): Promise<DocumentRecord> {
    const maxBytes = this.config.documents.maxSizeBytes;
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
      return this.reject('too_large');
    }
    const collectionKey = { id: collectionId, organizationId: context.organizationId };
    if (!(await this.collections.find(this.db, collectionKey))) {
      throw new AppError('COLLECTION_NOT_FOUND');
    }

    const file = await receiveFile(request, maxBytes).catch((error: unknown) => {
      throw this.rejection(error);
    });
    const filename = sanitizeFilename(file.filename);
    if (!filename) {
      file.stream.resume();
      return this.reject('invalid', 'The file needs a name.');
    }
    const type = (() => {
      try {
        return resolveDocumentType(filename, file.declaredType);
      } catch (error) {
        file.stream.resume();
        throw this.rejection(error);
      }
    })();
    const { head, content } = await peek(file.stream, HEAD_BYTES).catch((error: unknown) => {
      throw this.rejection(error);
    });
    if (head.length === 0) {
      await content.return(undefined);
      return this.reject('invalid', 'The file is empty.');
    }
    try {
      checkSignature(type, head);
    } catch (error) {
      await content.return(undefined);
      throw this.rejection(error);
    }

    const document = await this.db.transaction(async (tx) => {
      // The share lock keeps the collection from being deleted until the row exists.
      if (!(await this.collections.find(tx, collectionKey, { lock: 'share' }))) {
        throw new AppError('COLLECTION_NOT_FOUND');
      }
      return this.documents.insertUploading(tx, {
        organizationId: context.organizationId,
        collectionId,
        filename,
        mediaType: type.mediaType,
        actor: context.actor,
      });
    });

    const inspected = inspectContent(content, type, maxBytes);
    try {
      await this.storage.put(document.objectKey, inspected.stream, type.mediaType);
      const stored = inspected.result();
      // The object must hold exactly the bytes that were sent.
      const object = await this.storage.head(document.objectKey);
      if (object?.size !== stored.sizeBytes) {
        throw new StorageError('head', object === undefined);
      }
      const available = await this.db.transaction(async (tx) => {
        const updated = await this.documents.markAvailable(tx, document, stored);
        if (updated) {
          await this.audit.record(tx, {
            action: 'DOCUMENT_UPLOADED',
            organizationId: context.organizationId,
            ...auditActor(context.actor),
            resourceType: 'document',
            resourceId: document.id,
            metadata: {
              collection: collectionId,
              mediaType: type.mediaType,
              sizeBytes: stored.sizeBytes,
              requestId: context.requestId ?? null,
            },
          });
        }
        return updated;
      });
      if (!available) {
        // Deleted while it was uploading: the deletion wins.
        await this.removeObject(document);
        throw new AppError('DOCUMENT_NOT_FOUND');
      }
      this.metrics.documentUploads.inc({ result: 'stored' });
      this.metrics.documentUploadBytes.inc(stored.sizeBytes);
      this.logger.info(
        {
          documentId: document.id,
          collectionId,
          mediaType: type.mediaType,
          sizeBytes: stored.sizeBytes,
        },
        'document stored',
      );
      return available;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const reason = failureReasonOf(inspected.failure() ?? error);
      await this.documents.markFailed(this.db, document, reason);
      await this.removeObject(document);
      this.logger.warn(
        { documentId: document.id, collectionId, reason, err: describe(error) },
        'document upload failed',
      );
      throw this.rejection(inspected.failure() ?? error, reason);
    }
  }

  async list(organizationId: string, collectionId: string): Promise<DocumentRecord[]> {
    if (!(await this.collections.find(this.db, { id: collectionId, organizationId }))) {
      throw new AppError('COLLECTION_NOT_FOUND');
    }
    return this.documents.listByCollection(this.db, { collectionId, organizationId });
  }

  async get(organizationId: string, id: string): Promise<DocumentRecord> {
    const document = await this.documents.find(this.db, { id, organizationId });
    if (!document) {
      throw new AppError('DOCUMENT_NOT_FOUND');
    }
    return document;
  }

  /**
   * The content of an AVAILABLE document, as a stream straight from storage.
   * Nothing is read into memory; the caller pipes it to the response.
   */
  async openContent(
    organizationId: string,
    id: string,
  ): Promise<{ document: DocumentRecord & { sizeBytes: number }; body: Readable }> {
    const document = await this.get(organizationId, id);
    if (document.status !== 'AVAILABLE' || document.sizeBytes === null) {
      this.metrics.documentDownloads.inc({ result: 'not_available' });
      throw new AppError('DOCUMENT_NOT_AVAILABLE');
    }
    let object: StoredObject;
    try {
      object = await this.storage.get(document.objectKey);
    } catch (error) {
      this.metrics.documentDownloads.inc({ result: 'storage_error' });
      if (error instanceof StorageError && error.notFound) {
        // AVAILABLE without an object: the two stores disagree.
        this.logger.error({ documentId: id }, 'stored object is missing');
        throw new AppError('DOCUMENT_NOT_AVAILABLE');
      }
      this.logger.warn({ documentId: id, err: describe(error) }, 'document download failed');
      throw new AppError('STORAGE_UNAVAILABLE');
    }
    if (object.size !== undefined && object.size !== document.sizeBytes) {
      object.body.destroy();
      this.metrics.documentDownloads.inc({ result: 'storage_error' });
      this.logger.error(
        { documentId: id, expected: document.sizeBytes, stored: object.size },
        'stored object has the wrong size',
      );
      throw new AppError('DOCUMENT_NOT_AVAILABLE');
    }
    this.metrics.documentDownloads.inc({ result: 'sent' });
    return { document: { ...document, sizeBytes: document.sizeBytes }, body: object.body };
  }

  /**
   * Deletes a document in two steps, because PostgreSQL and storage cannot
   * change together:
   *
   * 1. The row becomes DELETING. From then on it cannot be downloaded, and
   *    the deletion is recorded in the audit log.
   * 2. The object is deleted. Only then does the row become DELETED.
   *
   * If storage fails, the row stays DELETING and the error is returned:
   * calling delete again resumes at step 2. Deleting a DELETED document
   * succeeds without doing anything, so retries are safe.
   */
  async delete(context: ActionContext, id: string): Promise<void> {
    const key = { id, organizationId: context.organizationId };
    const document = await this.db.transaction(async (tx) => {
      const found = await this.documents.findForUpdate(tx, key);
      if (!found) {
        throw new AppError('DOCUMENT_NOT_FOUND');
      }
      if (found.status === 'DELETED' || found.status === 'DELETING') {
        return found;
      }
      await this.documents.markDeleting(tx, key);
      await this.audit.record(tx, {
        action: 'DOCUMENT_DELETED',
        organizationId: context.organizationId,
        ...auditActor(context.actor),
        resourceType: 'document',
        resourceId: id,
        metadata: {
          collection: found.collectionId,
          previousStatus: found.status,
          requestId: context.requestId ?? null,
        },
      });
      return found;
    });
    if (document.status === 'DELETED') return;

    try {
      // Deleting a missing object succeeds, so FAILED uploads and retries are fine.
      await this.storage.delete(document.objectKey);
    } catch (error) {
      this.metrics.documentDeletes.inc({ result: 'failed' });
      this.logger.warn({ documentId: id, err: describe(error) }, 'document deletion failed');
      throw new AppError('DOCUMENT_DELETE_FAILED');
    }
    await this.documents.markDeleted(this.db, key);
    this.metrics.documentDeletes.inc({ result: 'deleted' });
    this.logger.info({ documentId: id }, 'document deleted');
  }

  /** Best-effort removal of a partial or orphaned object; a failure is only logged. */
  private async removeObject(document: DocumentRecord): Promise<void> {
    try {
      await this.storage.delete(document.objectKey);
    } catch (error) {
      this.logger.warn(
        { documentId: document.id, err: describe(error) },
        'could not remove the stored object',
      );
    }
  }

  private reject(kind: 'too_large' | 'invalid', message?: string): never {
    this.metrics.documentUploads.inc({ result: 'rejected' });
    throw kind === 'too_large'
      ? new AppError('DOCUMENT_TOO_LARGE')
      : new AppError('INVALID_UPLOAD', message);
  }

  /** The client-facing error for a failure, counted once in the metrics. */
  private rejection(error: unknown, reason?: DocumentFailureReason): Error {
    const client =
      error instanceof DocumentTooLargeError ||
      error instanceof DocumentTypeError ||
      error instanceof InvalidUploadError;
    this.metrics.documentUploads.inc({ result: client ? 'rejected' : 'failed' });
    if (error instanceof DocumentTooLargeError) return new AppError('DOCUMENT_TOO_LARGE');
    if (error instanceof DocumentTypeError) return new AppError('DOCUMENT_TYPE_NOT_ALLOWED');
    if (error instanceof InvalidUploadError) return new AppError('INVALID_UPLOAD');
    if (error instanceof StorageError || reason) return new AppError('DOCUMENT_UPLOAD_FAILED');
    return error instanceof Error ? error : new Error(String(error));
  }
}

function failureReasonOf(error: unknown): DocumentFailureReason {
  if (error instanceof DocumentTooLargeError) return 'too_large';
  if (error instanceof DocumentTypeError) return 'type_not_allowed';
  if (error instanceof InvalidUploadError) return 'interrupted';
  return 'storage_error';
}

/** What is safe to log about an error: its kind, never SDK messages or request details. */
function describe(error: unknown): { name: string; operation?: string } {
  if (error instanceof StorageError) {
    return { name: error.name, operation: error.operation };
  }
  return { name: error instanceof Error ? error.name : typeof error };
}
