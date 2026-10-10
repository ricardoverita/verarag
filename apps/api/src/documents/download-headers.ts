import type { DocumentMediaType } from '@verarag/contracts';
import { create as contentDisposition } from 'content-disposition';

/**
 * Headers for sending a stored document. Uploaded files are untrusted, so a
 * download is always an attachment, never rendered: the browser saves it
 * instead of opening it, does not guess another type, and if it is opened
 * anyway (a saved HTML file, say) it runs sandboxed with nothing allowed.
 */
export function downloadHeaders(document: {
  filename: string;
  mediaType: DocumentMediaType;
  sizeBytes: number;
}): Record<string, string> {
  return {
    'Content-Type': document.mediaType.startsWith('text/')
      ? `${document.mediaType}; charset=utf-8`
      : document.mediaType,
    'Content-Length': String(document.sizeBytes),
    // Quotes and backslashes escaped, non-ASCII in filename* (RFC 8187).
    'Content-Disposition': contentDisposition(document.filename, { type: 'attachment' }),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
