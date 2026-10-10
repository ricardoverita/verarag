import { describe, expect, it } from 'vitest';

import { slugCandidates, slugify } from './slug.js';

describe('slugify', () => {
  it.each([
    ['Vera Labs', 'vera-labs'],
    ['  ACME   Corp.  ', 'acme-corp'],
    ['Diseño Ñandú', 'diseno-nandu'],
    ['R&D / Platform', 'r-d-platform'],
    ['東京', 'org'],
    ['!!', 'org'],
    ['a', 'org'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('keeps slugs short enough to add a suffix', () => {
    const slug = slugify('a very long organization name '.repeat(5));

    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).not.toMatch(/-$/);
  });
});

describe('slugCandidates', () => {
  it('numbers the alternatives after the first one', () => {
    expect(slugCandidates('vera-labs', 3)).toEqual(['vera-labs', 'vera-labs-2', 'vera-labs-3']);
  });
});
