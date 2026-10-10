import { describe, expect, it } from 'vitest';

import { formatBytes, formatDate, formatDateTime, formatExactBytes } from './format';

describe('formatDate', () => {
  it('renders dates in UTC', () => {
    expect(formatDate('2026-10-10T23:30:00.000Z')).toBe('Oct 10, 2026');
    expect(formatDateTime('2026-10-10T23:30:00.000Z')).toBe('Oct 10, 2026, 11:30 PM UTC');
  });
});

describe('formatBytes', () => {
  it('uses the largest unit that keeps the number readable', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatExactBytes(1572864)).toBe('1,572,864 bytes');
  });
});
