import { describe, expect, it } from 'vitest';

import { buildDocx, buildPdf, buildZip } from '../../test/support/zip.js';
import {
  checkSignature,
  contentValidator,
  DOCUMENT_TYPES,
  DocumentTypeError,
  resolveDocumentType,
} from './document-types.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function errorOf(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('resolveDocumentType', () => {
  it.each([
    ['manual.pdf', 'application/pdf', 'application/pdf'],
    ['Manual.PDF', '', 'application/pdf'],
    ['report.docx', DOCX, DOCX],
    ['report.docx', 'application/octet-stream', DOCX],
    ['notes.md', 'text/markdown', 'text/markdown'],
    ['notes.markdown', 'text/plain', 'text/markdown'],
    ['readme.txt', 'text/plain; charset=utf-8', 'text/plain'],
    ['page.html', 'text/html', 'text/html'],
    ['page.htm', '', 'text/html'],
  ])('accepts %s declared as "%s"', (filename, declared, mediaType) => {
    expect(resolveDocumentType(filename, declared).mediaType).toBe(mediaType);
  });

  it.each([
    ['setup.exe', 'application/octet-stream'],
    ['script.sh', 'text/plain'],
    ['archive.zip', 'application/zip'],
    ['photo.png', 'image/png'],
    ['song.mp3', 'audio/mpeg'],
    ['clip.mp4', 'video/mp4'],
    ['noextension', 'text/plain'],
    ['manual.pdf', 'image/png'],
    ['page.html', 'application/javascript'],
    ['report.docx', 'application/zip'],
  ])('refuses %s declared as "%s"', (filename, declared) => {
    expect(errorOf(() => resolveDocumentType(filename, declared))).toBeInstanceOf(
      DocumentTypeError,
    );
  });
});

describe('checkSignature', () => {
  const type = (mediaType: string) => DOCUMENT_TYPES.find((t) => t.mediaType === mediaType)!;

  it('checks the PDF header, allowing a little junk before it', () => {
    expect(errorOf(() => checkSignature(type('application/pdf'), buildPdf()))).toBeUndefined();
    expect(
      errorOf(() => checkSignature(type('application/pdf'), Buffer.from('\n\n%PDF-1.7'))),
    ).toBeUndefined();
    expect(
      errorOf(() => checkSignature(type('application/pdf'), Buffer.from('<html>'))),
    ).toBeInstanceOf(DocumentTypeError);
  });

  it('requires a ZIP header for DOCX', () => {
    expect(errorOf(() => checkSignature(type(DOCX), buildDocx()))).toBeUndefined();
    expect(errorOf(() => checkSignature(type(DOCX), Buffer.from('PK')))).toBeInstanceOf(
      DocumentTypeError,
    );
    expect(errorOf(() => checkSignature(type(DOCX), buildPdf()))).toBeInstanceOf(DocumentTypeError);
  });

  it('refuses NUL bytes in text', () => {
    expect(
      errorOf(() => checkSignature(type('text/plain'), Buffer.from('a\u0000b'))),
    ).toBeInstanceOf(DocumentTypeError);
  });
});

describe('contentValidator', () => {
  const validate = (mediaType: string, content: Buffer, chunkSize = 3) => {
    const validator = contentValidator(DOCUMENT_TYPES.find((t) => t.mediaType === mediaType)!);
    for (let offset = 0; offset < content.length; offset += chunkSize) {
      validator.update(content.subarray(offset, offset + chunkSize));
    }
    validator.finish(content.length);
  };

  it('accepts UTF-8 text even when characters are split across chunks', () => {
    expect(
      errorOf(() => validate('text/markdown', Buffer.from('# Título ñandú 日本語 😀'))),
    ).toBeUndefined();
  });

  it('refuses text that is not UTF-8 or ends in the middle of a character', () => {
    expect(errorOf(() => validate('text/plain', Buffer.from([0x68, 0xff, 0x69])))).toBeInstanceOf(
      DocumentTypeError,
    );
    expect(errorOf(() => validate('text/plain', Buffer.from([0x61, 0xe6, 0x97])))).toBeInstanceOf(
      DocumentTypeError,
    );
    expect(errorOf(() => validate('text/html', Buffer.from('<p>\u0000</p>')))).toBeInstanceOf(
      DocumentTypeError,
    );
  });

  it('accepts a Word document from its ZIP directory, without decompressing it', () => {
    expect(errorOf(() => validate(DOCX, buildDocx(), 7))).toBeUndefined();
  });

  it('refuses any other ZIP, macro-enabled documents and damaged archives', () => {
    expect(
      errorOf(() => validate(DOCX, buildZip({ 'notes.txt': 'not a document' }))),
    ).toBeInstanceOf(DocumentTypeError);
    const withMacros = buildZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/vbaProject.bin': 'macro',
    });
    expect(errorOf(() => validate(DOCX, withMacros))).toBeInstanceOf(DocumentTypeError);
    const truncated = buildDocx().subarray(0, 60);
    expect(errorOf(() => validate(DOCX, truncated))).toBeInstanceOf(DocumentTypeError);
  });
});
