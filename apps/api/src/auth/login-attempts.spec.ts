import { describe, expect, it } from 'vitest';

import { LoginAttempts } from './login-attempts.js';

describe('LoginAttempts', () => {
  const setup = () => {
    let now = 0;
    const attempts = new LoginAttempts(() => now);
    return { attempts, advance: (ms: number) => (now += ms) };
  };

  it('blocks an email after five failures', () => {
    const { attempts } = setup();

    for (let i = 0; i < 4; i++) attempts.recordFailure('ana@example.com');
    expect(attempts.isBlocked('ana@example.com')).toBe(false);

    attempts.recordFailure('ana@example.com');
    expect(attempts.isBlocked('ana@example.com')).toBe(true);
    expect(attempts.isBlocked('bob@example.com')).toBe(false);
  });

  it('forgets failures after fifteen minutes', () => {
    const { attempts, advance } = setup();
    for (let i = 0; i < 5; i++) attempts.recordFailure('ana@example.com');

    advance(15 * 60_000 + 1);

    expect(attempts.isBlocked('ana@example.com')).toBe(false);
  });

  it('starts over after a successful login', () => {
    const { attempts } = setup();
    for (let i = 0; i < 5; i++) attempts.recordFailure('ana@example.com');

    attempts.reset('ana@example.com');

    expect(attempts.isBlocked('ana@example.com')).toBe(false);
  });
});
