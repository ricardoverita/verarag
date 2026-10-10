import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime } from './format';

describe('formatDate', () => {
  it('renders dates in UTC', () => {
    expect(formatDate('2026-10-10T23:30:00.000Z')).toBe('Oct 10, 2026');
    expect(formatDateTime('2026-10-10T23:30:00.000Z')).toBe('Oct 10, 2026, 11:30 PM UTC');
  });
});
