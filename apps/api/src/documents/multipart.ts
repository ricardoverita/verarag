import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

import busboy from 'busboy';

/** Part name the file must be sent under. */
export const FILE_FIELD = 'file';

/** The upload could not be read as one file: wrong encoding, no file, or the client left. */
export class InvalidUploadError extends Error {
  override name = 'InvalidUploadError';
}

export interface IncomingFile {
  filename: string;
  declaredType: string;
  /** The file's bytes, straight from the request as they arrive. */
  stream: Readable;
  /** True once the parser cut the file at the size limit. */
  truncated(): boolean;
}

/**
 * Starts parsing a multipart/form-data request and resolves as soon as the
 * file part begins, with a stream of its bytes. The rest of the request is
 * read only as fast as that stream is consumed, so nothing is buffered.
 *
 * Exactly one part is accepted, named "file". The parser stops the file one
 * byte after `maxFileBytes`, so the caller sees that it was too large
 * without the parser reading the remainder.
 */
export function receiveFile(request: IncomingMessage, maxFileBytes: number): Promise<IncomingFile> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        limits: { files: 1, fields: 0, parts: 1, fileSize: maxFileBytes + 1, headerPairs: 20 },
      });
    } catch {
      reject(new InvalidUploadError('not a multipart/form-data request'));
      return;
    }

    let file: Readable | undefined;
    let truncated = false;

    parser.on('file', (name, stream, info) => {
      if (name !== FILE_FIELD) {
        stream.resume();
        reject(new InvalidUploadError(`unexpected part ${name}`));
        return;
      }
      file = stream;
      stream.on('limit', () => {
        truncated = true;
      });
      resolve({
        filename: info.filename ?? '',
        declaredType: info.mimeType ?? '',
        stream,
        truncated: () => truncated,
      });
    });
    parser.on('error', (error: Error) => {
      if (file) {
        file.destroy(new InvalidUploadError('the upload was interrupted', { cause: error }));
      } else {
        reject(new InvalidUploadError('the upload could not be read', { cause: error }));
      }
    });
    parser.on('close', () => {
      if (!file) reject(new InvalidUploadError('no file in the request'));
    });
    request.on('close', () => {
      if (!request.complete) {
        parser.destroy(new InvalidUploadError('the client went away'));
      }
    });
    request.pipe(parser);
  });
}

/**
 * Reads up to `bytes` from the start of the stream and returns them, along
 * with the whole content (those bytes included) to keep reading from.
 */
export async function peek(
  source: Readable,
  bytes: number,
): Promise<{ head: Buffer; content: AsyncGenerator<Buffer> }> {
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const chunks: Buffer[] = [];
  let length = 0;
  while (length < bytes) {
    const step = await iterator.next();
    if (step.done) break;
    chunks.push(step.value);
    length += step.value.length;
  }
  const head = Buffer.concat(chunks);

  async function* content(): AsyncGenerator<Buffer> {
    try {
      if (head.length > 0) yield head;
      while (true) {
        const step = await iterator.next();
        if (step.done) return;
        yield step.value;
      }
    } finally {
      await iterator.return?.();
    }
  }
  return { head, content: content() };
}
