import { createHash, randomBytes } from 'node:crypto';

/** 256 random bits, URL-safe. Used for session and invitation tokens. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What the database stores instead of a token. The tokens are long random
 * values, not passwords, so a fast hash is enough: there is nothing to guess.
 */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
