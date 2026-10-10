import { describe, expect, it } from 'vitest';

import { hashToken } from '../common/tokens.js';
import { apiKeyPrefix, generateApiKey } from './api-key-token.js';

describe('generateApiKey', () => {
  it('builds a key from its public prefix and a random secret', () => {
    const { key, prefix, hash } = generateApiKey();

    expect(prefix).toMatch(/^vrg_[0-9a-f]{12}$/);
    expect(key).toMatch(new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`));
    expect(hash).toEqual(hashToken(key));
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey().key));

    expect(keys.size).toBe(100);
  });
});

describe('apiKeyPrefix', () => {
  it('reads the prefix of a well-formed key', () => {
    const { key, prefix } = generateApiKey();

    expect(apiKeyPrefix(key)).toBe(prefix);
  });

  it('rejects anything else', () => {
    const { key } = generateApiKey();

    for (const value of [
      '',
      'vrg_',
      key.slice(0, -1),
      `${key}x`,
      key.toUpperCase(),
      key.replace('vrg_', 'abc_'),
      ` ${key}`,
    ]) {
      expect(apiKeyPrefix(value)).toBeUndefined();
    }
  });
});
