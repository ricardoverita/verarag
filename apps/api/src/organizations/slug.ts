const MAX_BASE_LENGTH = 48;

/**
 * Turns an organization name into a readable slug: "Vera Labs" → "vera-labs",
 * "Diseño Ñandú" → "diseno-nandu". Names without any usable character (for
 * example, only symbols or a non-Latin script) fall back to "org".
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, '');
  return base.length >= 2 ? base : 'org';
}

/**
 * Candidates tried in order when a slug is taken: vera-labs, vera-labs-2, …
 * The database's unique constraint decides; this only proposes names.
 */
export function slugCandidates(base: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => (index === 0 ? base : `${base}-${index + 1}`));
}
