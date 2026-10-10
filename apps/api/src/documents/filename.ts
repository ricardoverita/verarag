/**
 * Bidirectional overrides and isolates can make "report‮fdp.exe" display
 * as "reportexe.pdf", so they are removed along with control characters.
 */
const UNSAFE = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

const MAX_LENGTH = 255;

/**
 * The name to keep for an uploaded file: only its last path component,
 * NFC-normalized, without control or direction-changing characters, without
 * surrounding spaces or trailing dots, and at most 255 characters with its
 * extension kept. It is metadata only and never becomes a storage path.
 * Returns undefined when nothing usable is left.
 */
export function sanitizeFilename(raw: string): string | undefined {
  const lastComponent = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = lastComponent
    .normalize('NFC')
    .replace(UNSAFE, '')
    .trim()
    .replace(/[. ]+$/u, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return undefined;
  return truncateKeepingExtension(cleaned);
}

function truncateKeepingExtension(name: string): string {
  const characters = [...name];
  if (characters.length <= MAX_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 16 ? [...name.slice(dot)] : [];
  return [...characters.slice(0, MAX_LENGTH - extension.length), ...extension].join('');
}
