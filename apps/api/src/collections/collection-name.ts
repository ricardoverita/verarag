/**
 * The canonical form of a collection name: NFC-normalized, trimmed, with
 * runs of whitespace collapsed to one space. "Sales  Docs " and "sales docs"
 * then differ only in case, which the database's unique index ignores.
 */
export function normalizeCollectionName(name: string): string {
  return name.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
