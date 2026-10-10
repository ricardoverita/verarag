import type { DocumentFailureReason, DocumentStatus, UploadPolicy } from '@verarag/contracts';

import { formatBytes } from './format';

/** Only states that exist: the file is stored or not. Processing comes in a later phase. */
export const STATUS_LABELS: Record<DocumentStatus, string> = {
  UPLOADING: 'Uploading',
  AVAILABLE: 'Available',
  FAILED: 'Failed',
  DELETING: 'Deleting',
};

export const FAILURE_LABELS: Record<DocumentFailureReason, string> = {
  too_large: 'It was larger than the size limit.',
  type_not_allowed: 'Its content does not match a supported type.',
  storage_error: 'Storage was not available. Upload it again.',
  interrupted: 'The upload was interrupted. Upload it again.',
};

export const MEDIA_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (DOCX)',
  'text/markdown': 'Markdown',
  'text/plain': 'Plain text',
  'text/html': 'HTML',
};

/**
 * Checks a file against the API's upload policy before sending it, to fail
 * fast and save the upload. The API checks again, and checks the content.
 */
export function precheckFile(
  file: { name: string; size: number },
  policy: UploadPolicy,
): string | undefined {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!policy.types.some((type) => type.extensions.includes(extension))) {
    return `This type of file is not supported. Upload ${supportedSummary(policy)}.`;
  }
  if (file.size === 0) {
    return 'The file is empty.';
  }
  if (file.size > policy.maxSizeBytes) {
    return `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(policy.maxSizeBytes)}.`;
  }
  return undefined;
}

export function supportedSummary(policy: UploadPolicy): string {
  return policy.types.map((type) => MEDIA_TYPE_LABELS[type.mediaType] ?? type.mediaType).join(', ');
}

export function acceptAttribute(policy: UploadPolicy): string {
  return policy.types.flatMap((type) => type.extensions).join(',');
}
