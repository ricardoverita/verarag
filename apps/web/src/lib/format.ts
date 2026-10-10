const DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const DATE_TIME = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Dates in UTC, so the server and the browser render the same text. */
export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

const NUMBER = new Intl.NumberFormat('en');

/** "512 B", "1.5 KB", "24 MB": powers of 1024, one decimal below 10. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** "1,572,864 bytes". */
export function formatExactBytes(bytes: number): string {
  return `${NUMBER.format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
}
