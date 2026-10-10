import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { inspectContent } from './content-inspector.js';
import { DOCUMENT_TYPES, DocumentTooLargeError, DocumentTypeError } from './document-types.js';

const text = DOCUMENT_TYPES.find((type) => type.mediaType === 'text/plain')!;

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Yields `count` chunks and records how many were pulled. */
function source(chunk: Buffer, count: number) {
  const state = { pulled: 0 };
  async function* generate() {
    for (let i = 0; i < count; i += 1) {
      state.pulled += 1;
      yield await Promise.resolve(chunk);
    }
  }
  return { state, iterable: generate() };
}

describe('inspectContent', () => {
  it('passes the bytes through and computes their size and SHA-256', async () => {
    const chunk = Buffer.from('VeraRAG line\n');
    const { iterable } = source(chunk, 1000);

    const inspected = inspectContent(iterable, text, 1024 * 1024);
    const passed = await drain(inspected.stream);

    const expected = Buffer.concat(Array.from({ length: 1000 }, () => chunk));
    expect(passed.equals(expected)).toBe(true);
    expect(inspected.result()).toEqual({
      sizeBytes: expected.length,
      sha256: createHash('sha256').update(expected).digest('hex'),
    });
  });

  it('stops at the first chunk over the limit instead of reading everything', async () => {
    const { state, iterable } = source(Buffer.alloc(1024, 'a'), 10_000);

    const inspected = inspectContent(iterable, text, 10 * 1024);

    await expect(drain(inspected.stream)).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(state.pulled).toBe(11);
    expect(inspected.failure()).toBeInstanceOf(DocumentTooLargeError);
    expect(() => inspected.result()).toThrow(DocumentTooLargeError);
  });

  it('fails the stream when the content is not what the extension says', async () => {
    const { iterable } = source(Buffer.from([0xc3, 0x28]), 1);

    const inspected = inspectContent(iterable, text, 1024);

    await expect(drain(inspected.stream)).rejects.toBeInstanceOf(DocumentTypeError);
  });
});
