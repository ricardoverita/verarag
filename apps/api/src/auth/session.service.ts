import { Inject, Injectable } from '@nestjs/common';

import { AppError } from '../common/app-error.js';
import { generateToken, hashToken } from '../common/tokens.js';
import { CONFIG, type Config } from '../config/config.js';
import { Database, type Queryable } from '../database/database.js';
import type { SessionPrincipal } from './principal.js';
import { SESSION_TOUCH_INTERVAL_MS, SessionsRepository } from './sessions.repository.js';

export interface StartedSession {
  /** Shown once, in the Set-Cookie header. Only its hash is stored. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: Database,
    private readonly sessions: SessionsRepository,
  ) {}

  async start(tx: Queryable, userId: string): Promise<StartedSession> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.config.sessions.ttlHours * 3_600_000);
    const sessionId = await this.sessions.insert(tx, {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    });
    return { token, sessionId, expiresAt };
  }

  /** Resolves a cookie token into a principal, or fails with a session error. */
  async authenticate(token: string): Promise<SessionPrincipal> {
    const session = await this.sessions.findByTokenHash(this.db, hashToken(token));
    if (!session || session.revokedAt || session.user.status !== 'active') {
      throw new AppError('INVALID_SESSION');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('SESSION_EXPIRED');
    }
    if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      await this.sessions.touch(this.db, session.id);
    }
    const { id, email, displayName, createdAt } = session.user;
    return {
      kind: 'session',
      user: { id, email, displayName, createdAt },
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  }

  revoke(db: Queryable, sessionId: string): Promise<void> {
    return this.sessions.revoke(db, sessionId);
  }

  /** Revokes whatever session a token points to, if any. */
  revokeToken(db: Queryable, token: string): Promise<void> {
    return this.sessions.revokeByTokenHash(db, hashToken(token));
  }
}
