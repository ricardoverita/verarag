import type { DocumentsResponse, DocumentView, UploadPolicy } from '@verarag/contracts';
import { z } from 'zod';

import { actorView } from '../common/actor.dto.js';
import { DOCUMENT_TYPES } from './document-types.js';
import type { DocumentRecord } from './documents.repository.js';

export const documentIdParam = z.uuid();

const mediaTypeSchema = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
  'text/html',
]);

export const documentView = z.object({
  id: z.uuid(),
  collectionId: z.uuid(),
  filename: z.string(),
  mediaType: mediaTypeSchema,
  sizeBytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  status: z.enum(['UPLOADING', 'AVAILABLE', 'FAILED', 'DELETING']),
  failureReason: z
    .enum(['too_large', 'type_not_allowed', 'storage_error', 'interrupted'])
    .nullable(),
  createdBy: actorView,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<DocumentView>;

export const documentsResponse = z.object({
  documents: z.array(documentView),
}) satisfies z.ZodType<DocumentsResponse>;

export const uploadPolicy = z.object({
  maxSizeBytes: z.number().int(),
  types: z.array(z.object({ mediaType: mediaTypeSchema, extensions: z.array(z.string()) })),
}) satisfies z.ZodType<UploadPolicy>;

export function toUploadPolicy(maxSizeBytes: number): UploadPolicy {
  return {
    maxSizeBytes,
    types: DOCUMENT_TYPES.map((type) => ({
      mediaType: type.mediaType,
      extensions: [...type.extensions],
    })),
  };
}

export function toDocumentView(document: DocumentRecord): DocumentView {
  if (document.status === 'DELETED') {
    // Deleted documents are filtered out by every query; reaching here is a bug.
    throw new Error('a deleted document cannot be shown');
  }
  return {
    id: document.id,
    collectionId: document.collectionId,
    filename: document.filename,
    mediaType: document.mediaType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    status: document.status,
    failureReason: document.failureReason,
    createdBy: document.createdBy,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
