import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { contentValidator, type DocumentType, DocumentTooLargeError } from './document-types.js';

export interface InspectedContent {
  /** The same bytes, for object storage. Errors here when a check fails. */
  stream: Readable;
  /** Size and SHA-256 of everything that went through; only valid after a full read. */
  result(): { sizeBytes: number; sha256: string };
  /** The check that stopped the stream, if one did. */
  failure(): Error | undefined;
}

/**
 * Passes the upload through on its way to storage, chunk by chunk and with
 * backpressure, while it counts the bytes, computes SHA-256 and validates
 * the content. Nothing is kept beyond the current chunk (and, for DOCX, the
 * last few hundred KiB needed to read the ZIP directory).
 *
 * The size limit is enforced as bytes arrive: an oversized upload stops at
 * the first byte over the limit, not after the whole file was received.
 */
export function inspectContent(
  source: AsyncIterable<Buffer>,
  type: DocumentType,
  maxBytes: number,
): InspectedContent {
  const hash = createHash('sha256');
  const validator = contentValidator(type);
  let sizeBytes = 0;
  let failure: Error | undefined;
  let sha256: string | undefined;

  async function* run(): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of source) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) {
          throw new DocumentTooLargeError(`more than ${maxBytes} bytes`);
        }
        hash.update(chunk);
        validator.update(chunk);
        yield chunk;
      }
      validator.finish(sizeBytes);
      sha256 = hash.digest('hex');
    } catch (error) {
      failure = error as Error;
      throw error;
    }
  }

  return {
    stream: Readable.from(run(), { objectMode: false }),
    result() {
      if (sha256 === undefined) {
        throw failure ?? new Error('the content was not read to the end');
      }
      return { sizeBytes, sha256 };
    },
    failure: () => failure,
  };
}
