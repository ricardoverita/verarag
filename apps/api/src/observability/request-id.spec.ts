import { describe, expect, it } from 'vitest';

import { resolveRequestId } from './request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a well-formed incoming id', () => {
    expect(resolveRequestId('web-7f3a:01')).toBe('web-7f3a:01');
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });

  it('creates a new id when none is sent', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
  });

  it.each([
    ['contains spaces', 'hello world'],
    ['tries to inject a log line', 'abc\nlevel=error'],
    ['is too long', 'a'.repeat(129)],
    ['is empty', ''],
  ])('replaces an id that %s', (_case, incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID);
  });
});
