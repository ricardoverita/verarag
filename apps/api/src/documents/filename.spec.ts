import { describe, expect, it } from 'vitest';

import { sanitizeFilename } from './filename.js';
import { decodeFormFilename } from './multipart.js';

describe('sanitizeFilename', () => {
  it('keeps ordinary names, including non-ASCII ones', () => {
    expect(sanitizeFilename('Manual de usuario (v2).pdf')).toBe('Manual de usuario (v2).pdf');
    expect(sanitizeFilename('informe-año.docx')).toBe('informe-año.docx');
  });

  it('keeps only the last path component', () => {
    expect(sanitizeFilename('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('C:\\Users\\ana\\notes.md')).toBe('notes.md');
  });

  it('removes control and direction-changing characters', () => {
    expect(sanitizeFilename('report\r\nX-Injected: 1.pdf')).toBe('reportX-Injected: 1.pdf');
    expect(sanitizeFilename('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(sanitizeFilename('a\u0000b.txt')).toBe('ab.txt');
  });

  it('trims spaces and trailing dots, and refuses names with nothing left', () => {
    expect(sanitizeFilename('  notes.txt. . ')).toBe('notes.txt');
    for (const name of ['', '   ', '..', '/', 'folder/', '\u202E']) {
      expect(sanitizeFilename(name)).toBeUndefined();
    }
  });

  it('shortens long names to 255 characters, keeping the extension', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.pdf`)!;

    expect([...name]).toHaveLength(255);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('decodeFormFilename', () => {
  it('turns back the quotes browsers encode in multipart file names', () => {
    expect(decodeFormFilename('Report %22final%22.pdf')).toBe('Report "final".pdf');
    expect(decodeFormFilename('a%0D%0Ab.txt')).toBe('ab.txt');
  });
});
