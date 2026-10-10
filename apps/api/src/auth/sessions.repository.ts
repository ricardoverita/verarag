import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';

export interface SessionWithUser {
  id: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: 'active' | 'disabled';
    createdAt: Date;
  };
}

interface SessionWithUserRow {
  id: string;
  expires_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  user_id: string;
  email: string;
  display_name: string;
  status: 'active' | 'disabled';
  user_created_at: Date;
}

/** How often `last_seen_at` may be written for the same session. */
const TOUCH_INTERVAL = "interval '5 minutes'";

@Injectable()
export class SessionsRepository {
  async insert(
    db: Queryable,
    input: { userId: string; tokenHash: Buffer; expiresAt: Date },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
      [input.userId, input.tokenHash, input.expiresAt],
    );
    return rows[0]!.id;
  }

  async findByTokenHash(db: Queryable, tokenHash: Buffer): Promise<SessionWithUser | undefined> {
    const { rows } = await db.query<SessionWithUserRow>(
      `SELECT s.id, s.expires_at, s.last_seen_at, s.revoked_at,
              u.id AS user_id, u.email, u.display_name, u.status, u.created_at AS user_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    return (
      row && {
        id: row.id,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
        user: {
          id: row.user_id,
          email: row.email,
          displayName: row.display_name,
          status: row.status,
          createdAt: row.user_created_at,
        },
      }
    );
  }

  /** Updates `last_seen_at` only if it is older than the touch interval. */
  async touch(db: Queryable, sessionId: string): Promise<void> {
    await db.query(
      `UPDATE sessions SET last_seen_at = now()
       WHERE id = $1 AND last_seen_at < now() - ${TOUCH_INTERVAL}`,
      [sessionId],
    );
  }

  async revoke(db: Queryable, sessionId: string): Promise<void> {
    await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
      sessionId,
    ]);
  }

  async revokeByTokenHash(db: Queryable, tokenHash: Buffer): Promise<void> {
    await db.query(
      'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }

  async countActive(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > now()',
    );
    return Number(rows[0]?.count ?? 0);
  }
}

export const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;
