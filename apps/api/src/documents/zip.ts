const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const END_RECORD_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;

/**
 * The file names listed in a ZIP's central directory, read from `tail`, the
 * last bytes of a file of `totalSize` bytes. Only the directory is parsed:
 * nothing is decompressed and no entry is opened.
 *
 * Returns undefined when the directory cannot be read from the tail: not a
 * ZIP, a damaged one, a ZIP64 archive, or a directory larger than the tail.
 */
export function zipEntryNames(tail: Buffer, totalSize: number): string[] | undefined {
  const end = findEndRecord(tail);
  if (end === undefined) return undefined;

  const entries = tail.readUInt16LE(end + 10);
  const directorySize = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return undefined;
  }

  const tailStart = totalSize - tail.length;
  const start = directoryOffset - tailStart;
  if (start < 0 || start + directorySize > end) return undefined;

  const names: string[] = [];
  let position = start;
  for (let index = 0; index < entries; index += 1) {
    if (position + 46 > end || tail.readUInt32LE(position) !== CENTRAL_DIRECTORY_ENTRY) {
      return undefined;
    }
    const nameLength = tail.readUInt16LE(position + 28);
    const extraLength = tail.readUInt16LE(position + 30);
    const commentLength = tail.readUInt16LE(position + 32);
    const nameEnd = position + 46 + nameLength;
    if (nameEnd > end) return undefined;
    names.push(tail.toString('utf8', position + 46, nameEnd));
    position = nameEnd + extraLength + commentLength;
  }
  return names;
}

/** Offset of the end-of-central-directory record, searching backwards past a possible comment. */
function findEndRecord(tail: Buffer): number | undefined {
  const lowest = Math.max(0, tail.length - END_RECORD_LENGTH - MAX_COMMENT_LENGTH);
  for (let offset = tail.length - END_RECORD_LENGTH; offset >= lowest; offset -= 1) {
    if (tail.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  return undefined;
}
