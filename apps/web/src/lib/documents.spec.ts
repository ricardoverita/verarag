import type { UploadPolicy } from '@verarag/contracts';
import { describe, expect, it } from 'vitest';

import { acceptAttribute, precheckFile } from './documents';

const policy: UploadPolicy = {
  maxSizeBytes: 1024,
  types: [
    { mediaType: 'application/pdf', extensions: ['.pdf'] },
    { mediaType: 'text/markdown', extensions: ['.md', '.markdown'] },
  ],
};

describe('precheckFile', () => {
  it('accepts supported files within the limit', () => {
    expect(precheckFile({ name: 'Manual.PDF', size: 10 }, policy)).toBeUndefined();
    expect(precheckFile({ name: 'notes.markdown', size: 1024 }, policy)).toBeUndefined();
  });

  it('explains what is wrong before anything is sent', () => {
    expect(precheckFile({ name: 'setup.exe', size: 10 }, policy)).toBe(
      'This type of file is not supported. Upload PDF, Markdown.',
    );
    expect(precheckFile({ name: 'big.pdf', size: 2048 }, policy)).toBe(
      'The file is 2.0 KB; the limit is 1.0 KB.',
    );
    expect(precheckFile({ name: 'empty.md', size: 0 }, policy)).toBe('The file is empty.');
  });
});

describe('acceptAttribute', () => {
  it('lists the extensions for the file picker', () => {
    expect(acceptAttribute(policy)).toBe('.pdf,.md,.markdown');
  });
});
