import { Injectable } from '@nestjs/common';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
/** Bounds memory if someone sprays logins for many different emails. */
const MAX_TRACKED_EMAILS = 10_000;

interface Failures {
  count: number;
  firstAt: number;
}

/**
 * Basic protection against password guessing on one account: after five
 * failed logins for an email within fifteen minutes, further attempts for
 * that email are refused until the window passes, whatever the source IP.
 *
 * It lives in memory, which is correct for a single API instance. With
 * several replicas each one counts separately; moving it to Redis is part of
 * running the API horizontally (see ADR 0008).
 */
@Injectable()
export class LoginAttempts {
  private readonly failures = new Map<string, Failures>();

  constructor(private readonly now: () => number = Date.now) {}

  isBlocked(email: string): boolean {
    const entry = this.current(email);
    return entry !== undefined && entry.count >= MAX_FAILURES;
  }

  recordFailure(email: string): void {
    const entry = this.current(email);
    if (entry) {
      entry.count += 1;
      return;
    }
    if (this.failures.size >= MAX_TRACKED_EMAILS) {
      // Maps keep insertion order: drop the oldest entry.
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
    this.failures.set(email, { count: 1, firstAt: this.now() });
  }

  reset(email: string): void {
    this.failures.delete(email);
  }

  private current(email: string): Failures | undefined {
    const entry = this.failures.get(email);
    if (entry && this.now() - entry.firstAt > WINDOW_MS) {
      this.failures.delete(email);
      return undefined;
    }
    return entry;
  }
}
