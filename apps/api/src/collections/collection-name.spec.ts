import { describe, expect, it } from 'vitest';

import { normalizeCollectionName } from './collection-name.js';

describe('normalizeCollectionName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCollectionName('  Sales \t  Docs\n')).toBe('Sales Docs');
  });

  it('uses the composed Unicode form, so equal names look equal to the database', () => {
    expect(normalizeCollectionName('Café')).toBe('Café');
    expect(normalizeCollectionName('Café')).toBe(normalizeCollectionName('Café'));
  });
});
