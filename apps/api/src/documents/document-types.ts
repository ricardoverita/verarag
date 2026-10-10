import { extname } from 'node:path';

import type { DocumentMediaType } from '@verarag/contracts';

import { zipEntryNames } from './zip.js';

/**
 * Errors that reject the content of an upload. They are the client's
 * problem, unlike storage errors, and map to 413 or 415.
 */
export class DocumentTooLargeError extends Error {
  override name = 'DocumentTooLargeError';
}

export class DocumentTypeError extends Error {
  override name = 'DocumentTypeError';
}

type Format = 'pdf' | 'docx' | 'text';

export interface DocumentType {
  mediaType: DocumentMediaType;
  extensions: readonly string[];
  /** Content types a browser or client may declare for it, besides the generic ones. */
  declared: readonly string[];
  format: Format;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The only files accepted for now. The extension picks the type, the
 * declared content type must not contradict it, and the content must look
 * like it: none of the three is trusted alone.
 */
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  {
    mediaType: 'application/pdf',
    extensions: ['.pdf'],
    declared: ['application/pdf', 'application/x-pdf'],
    format: 'pdf',
  },
  { mediaType: DOCX, extensions: ['.docx'], declared: [DOCX], format: 'docx' },
  {
    mediaType: 'text/markdown',
    extensions: ['.md', '.markdown'],
    declared: ['text/markdown', 'text/x-markdown', 'text/plain'],
    format: 'text',
  },
  { mediaType: 'text/plain', extensions: ['.txt'], declared: ['text/plain'], format: 'text' },
  {
    mediaType: 'text/html',
    extensions: ['.html', '.htm'],
    declared: ['text/html'],
    format: 'text',
  },
];

/** What clients send when they do not know the type; it neither confirms nor contradicts. */
const GENERIC_DECLARED = new Set(['', 'application/octet-stream']);

/** Bytes read before the upload starts, to check the file's signature. */
export const HEAD_BYTES = 8 * 1024;

/** Picks the type from the file name and checks the declared content type against it. */
export function resolveDocumentType(filename: string, declaredType: string): DocumentType {
  const extension = extname(filename).toLowerCase();
  const type = DOCUMENT_TYPES.find((candidate) => candidate.extensions.includes(extension));
  if (!type) {
    throw new DocumentTypeError(`extension ${extension || '(none)'} is not supported`);
  }
  const declared = declaredType.split(';')[0]!.trim().toLowerCase();
  if (!GENERIC_DECLARED.has(declared) && !type.declared.includes(declared)) {
    throw new DocumentTypeError(`declared type ${declared} does not match ${type.mediaType}`);
  }
  return type;
}

/** Checks the first bytes of the file. `head` may be shorter than HEAD_BYTES for small files. */
export function checkSignature(type: DocumentType, head: Buffer): void {
  switch (type.format) {
    case 'pdf':
      // The header may follow a little junk; readers accept it within 1 KiB.
      if (head.subarray(0, 1024).indexOf('%PDF-') === -1) {
        throw new DocumentTypeError('not a PDF');
      }
      return;
    case 'docx':
      // A ZIP local file header. Any ZIP starts like this, so the structure
      // is checked again at the end of the upload.
      if (head.length < 4 || head.readUInt32LE(0) !== 0x04034b50) {
        throw new DocumentTypeError('not a ZIP container');
      }
      return;
    case 'text':
      if (head.includes(0)) {
        throw new DocumentTypeError('text with NUL bytes');
      }
      return;
  }
}

/**
 * Checks the whole content as it streams by, without keeping it. `update`
 * sees every chunk in order, `finish` runs at the end with the total size.
 */
export interface ContentValidator {
  update(chunk: Buffer): void;
  finish(size: number): void;
}

/** Bytes kept from the end of a DOCX to read its ZIP central directory. */
const ZIP_TAIL_BYTES = 256 * 1024;

export function contentValidator(type: DocumentType): ContentValidator {
  switch (type.format) {
    case 'pdf':
      return { update() {}, finish() {} };
    case 'text':
      return textValidator();
    case 'docx':
      return docxValidator();
  }
}

/** UTF-8 only, and no NUL bytes: binary files renamed to .txt or .html fail here. */
function textValidator(): ContentValidator {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    update(chunk) {
      if (chunk.includes(0)) {
        throw new DocumentTypeError('text with NUL bytes');
      }
      try {
        decoder.decode(chunk, { stream: true });
      } catch {
        throw new DocumentTypeError('text that is not UTF-8');
      }
    },
    finish() {
      try {
        decoder.decode();
      } catch {
        throw new DocumentTypeError('text that is not UTF-8');
      }
    },
  };
}

/**
 * A DOCX is a ZIP whose central directory lists [Content_Types].xml and
 * word/document.xml. Only the directory is read, from the end of the file,
 * and nothing is decompressed. Macro-enabled documents are refused.
 */
function docxValidator(): ContentValidator {
  const tail: Buffer[] = [];
  let tailLength = 0;
  return {
    update(chunk) {
      tail.push(chunk);
      tailLength += chunk.length;
      while (tail.length > 1 && tailLength - tail[0]!.length >= ZIP_TAIL_BYTES) {
        tailLength -= tail.shift()!.length;
      }
    },
    finish(size) {
      const names = zipEntryNames(Buffer.concat(tail), size);
      if (!names) {
        throw new DocumentTypeError('not a readable ZIP container');
      }
      if (!names.includes('[Content_Types].xml') || !names.includes('word/document.xml')) {
        throw new DocumentTypeError('a ZIP file that is not a Word document');
      }
      if (names.includes('word/vbaProject.bin')) {
        throw new DocumentTypeError('a Word document with macros');
      }
    },
  };
}
