import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  passwordHash: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: 'active' | 'disabled';
  password_hash: string;
  created_at: Date;
}

const COLUMNS = 'id, email, display_name, status, password_hash, created_at';

/**
 * Users are global: one person can belong to several organizations, so these
 * queries are not scoped by organization. Everything an organization owns is.
 */
@Injectable()
export class UsersRepository {
  async insert(
    db: Queryable,
    input: { email: string; passwordHash: string; displayName: string },
  ): Promise<UserRecord> {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [input.email, input.passwordHash, input.displayName],
    );
    return toRecord(rows[0]!);
  }

  async findByEmail(db: Queryable, email: string): Promise<UserRecord | undefined> {
    const { rows } = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [
      email,
    ]);
    return rows[0] && toRecord(rows[0]);
  }

  async updatePasswordHash(db: Queryable, userId: string, passwordHash: string): Promise<void> {
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
  }
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}
