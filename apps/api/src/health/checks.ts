import type { ComponentName, ComponentStatus } from '@verarag/contracts';

export type CheckDetails = Record<string, string | number | boolean>;

export type Check = () => Promise<CheckDetails | void>;

/** A failed check whose message is safe to return in the status response. */
export class CheckFailedError extends Error {
  override name = 'CheckFailedError';
}

export class CheckTimeoutError extends Error {
  override name = 'CheckTimeoutError';

  constructor(timeoutMs: number) {
    super(`no response after ${timeoutMs} ms`);
  }
}

export interface CheckFailureLogger {
  warn(details: { component: ComponentName; err: unknown }, message: string): void;
}

/**
 * Runs a dependency check with a time limit. Unexpected errors are logged with
 * their details but reported to clients only as "unavailable", so the status
 * endpoint does not leak hostnames or driver messages.
 */
export async function runCheck(
  name: ComponentName,
  check: Check,
  timeoutMs: number,
  logger: CheckFailureLogger,
): Promise<ComponentStatus> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  try {
    const details = await withTimeout(check(), timeoutMs);
    return { name, status: 'up', latencyMs: elapsed(), ...(details ? { details } : {}) };
  } catch (error) {
    logger.warn({ component: name, err: error }, `${name} check failed`);
    const safe = error instanceof CheckFailedError || error instanceof CheckTimeoutError;
    return {
      name,
      status: 'down',
      latencyMs: elapsed(),
      error: safe ? error.message : 'unavailable',
    };
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
