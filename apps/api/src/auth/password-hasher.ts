import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface Argon2Parameters {
  /** Memory in KiB. */
  memory: number;
  passes: number;
  parallelism: number;
}

/**
 * Argon2id with 64 MiB of memory and 3 passes, the second recommended option
 * of RFC 9106 for memory-constrained environments. It takes about 150–300 ms
 * per hash on the development machines we measured, and libuv's thread pool
 * caps it at four concurrent hashes per process.
 */
export const DEFAULT_ARGON2_PARAMETERS: Argon2Parameters = {
  memory: 64 * 1024,
  passes: 3,
  parallelism: 1,
};

const SALT_BYTES = 16;
const HASH_BYTES = 32;

export interface PasswordCheck {
  valid: boolean;
  /** The hash was made with older parameters and should be replaced. */
  needsRehash: boolean;
}

/**
 * Hashes passwords with Node's built-in Argon2id and stores them as PHC
 * strings (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`), so the parameters travel
 * with each hash and can be raised later without breaking existing users.
 */
@Injectable()
export class PasswordHasher {
  private dummyHash?: Promise<string>;

  constructor(private readonly parameters: Argon2Parameters = DEFAULT_ARGON2_PARAMETERS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const hash = await derive(password, salt, this.parameters, HASH_BYTES);
    return encode(this.parameters, salt, hash);
  }

  async verify(encoded: string, password: string): Promise<PasswordCheck> {
    const parsed = decode(encoded);
    if (!parsed) {
      return { valid: false, needsRehash: false };
    }
    const candidate = await derive(password, parsed.salt, parsed.parameters, parsed.hash.length);
    const valid = timingSafeEqual(candidate, parsed.hash);
    const current = this.parameters;
    const needsRehash =
      parsed.parameters.memory !== current.memory ||
      parsed.parameters.passes !== current.passes ||
      parsed.parameters.parallelism !== current.parallelism;
    return { valid, needsRehash: valid && needsRehash };
  }

  /**
   * Spends the same time as a real verification. Login calls it when the
   * email does not exist, so response times do not reveal which accounts do.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    await this.verify(await this.dummyHash, password);
  }
}

function derive(
  password: string,
  salt: Buffer,
  parameters: Argon2Parameters,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        memory: parameters.memory,
        passes: parameters.passes,
        parallelism: parameters.parallelism,
        tagLength: length,
      },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

function encode(parameters: Argon2Parameters, salt: Buffer, hash: Buffer): string {
  const { memory, passes, parallelism } = parameters;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function decode(
  encoded: string,
): { parameters: Argon2Parameters; salt: Buffer; hash: Buffer } | undefined {
  const match = PHC.exec(encoded);
  if (!match) {
    return undefined;
  }
  const [, memory, passes, parallelism, salt, hash] = match;
  return {
    parameters: {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
    },
    salt: Buffer.from(salt ?? '', 'base64'),
    hash: Buffer.from(hash ?? '', 'base64'),
  };
}

/** PHC strings use standard base64 without padding. */
function b64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}
