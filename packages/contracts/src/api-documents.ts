/**
 * HTTP payloads for documents. The content itself travels as
 * multipart/form-data on upload and as the raw bytes on download.
 */
import type { ActorView } from './api-collections.js';

export type DocumentMediaType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/markdown'
  | 'text/plain'
  | 'text/html';

/**
 * The state of the stored file only. Whether a document has been processed
 * for search is a separate state that arrives with ingestion.
 */
export type DocumentStatus = 'UPLOADING' | 'AVAILABLE' | 'FAILED' | 'DELETING';

/** Why an upload ended in FAILED. */
export type DocumentFailureReason =
  'too_large' | 'type_not_allowed' | 'storage_error' | 'interrupted';

export interface DocumentView {
  id: string;
  collectionId: string;
  /** The name it was uploaded with, cleaned of paths and control characters. */
  filename: string;
  mediaType: DocumentMediaType;
  /** Set once the upload is complete. */
  sizeBytes: number | null;
  /** SHA-256 of the content as 64 lowercase hex characters, once complete. */
  sha256: string | null;
  status: DocumentStatus;
  failureReason: DocumentFailureReason | null;
  createdBy: ActorView;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentsResponse {
  documents: DocumentView[];
}

/** What the API accepts, so clients can check a file before sending it. */
export interface UploadPolicy {
  maxSizeBytes: number;
  types: { mediaType: DocumentMediaType; extensions: string[] }[];
}
