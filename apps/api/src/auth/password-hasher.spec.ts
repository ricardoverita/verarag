import { describe, expect, it } from 'vitest';

import { PasswordHasher } from './password-hasher.js';

// Cheap parameters keep the unit tests fast; the format and logic are the same.
const fast = new PasswordHasher({ memory: 1024, passes: 1, parallelism: 1 });

describe('PasswordHasher', () => {
  it('produces an Argon2id PHC string with a random salt', async () => {
    const first = await fast.hash('correct horse battery staple');
    const second = await fast.hash('correct horse battery staple');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('correct horse');
  });

  it('accepts the right password and rejects any other', async () => {
    const hash = await fast.hash('correct horse battery staple');

    await expect(fast.verify(hash, 'correct horse battery staple')).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(fast.verify(hash, 'correct horse battery stapl')).resolves.toMatchObject({
      valid: false,
    });
  });

  it('asks to rehash passwords stored with older parameters', async () => {
    const stronger = new PasswordHasher({ memory: 2048, passes: 2, parallelism: 1 });
    const oldHash = await fast.hash('correct horse battery staple');

    await expect(stronger.verify(oldHash, 'correct horse battery staple')).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(stronger.verify(oldHash, 'wrong password!')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('treats malformed hashes as a failed check', async () => {
    await expect(fast.verify('plain-text-password', 'plain-text-password')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('can run a verification for unknown accounts', async () => {
    await expect(fast.verifyAgainstDummy('anything at all')).resolves.toBeUndefined();
  });
});
