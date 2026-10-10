import { randomBytes } from 'node:crypto';

import { hashToken } from '../common/tokens.js';

/**
 * `vrg_` + 12 hex characters of public prefix + `_` + 256 random bits in
 * base64url. The fixed `vrg_` start makes leaked keys easy to find with
 * secret scanners.
 */
const API_KEY = /^(vrg_[0-9a-f]{12})_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  /** Shown once to the person who creates it. */
  key: string;
  prefix: string;
  /**
   * SHA-256 of the whole key. Like session tokens, keys are long random
   * values, so a fast hash is enough: there is nothing to guess.
   */
  hash: Buffer;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = `vrg_${randomBytes(6).toString('hex')}`;
  const key = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix, hash: hashToken(key) };
}

/** The public prefix of a well-formed key, or undefined for anything else. */
export function apiKeyPrefix(key: string): string | undefined {
  return API_KEY.exec(key)?.[1];
}
