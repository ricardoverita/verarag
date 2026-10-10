import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';
import type { OrganizationRecord } from './organizations.repository.js';
import type { Role } from './roles.js';

export interface MembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}

export interface MemberRecord extends MembershipRecord {
  user: { id: string; email: string; displayName: string };
}

export interface UserMembership {
  role: Role;
  joinedAt: Date;
  organization: OrganizationRecord;
}

interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: Role;
  created_at: Date;
}

interface MemberRow extends MembershipRow {
  email: string;
  display_name: string;
}

interface UserMembershipRow {
  role: Role;
  joined_at: Date;
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

const COLUMNS = 'm.id, m.organization_id, m.user_id, m.role, m.created_at';

/**
 * Memberships always belong to an organization, so every query takes the
 * organization id: there is no way to look one up by its id alone, and a
 * membership id from another organization simply is not found.
 */
@Injectable()
export class MembershipsRepository {
  async insert(
    db: Queryable,
    input: { organizationId: string; userId: string; role: Role },
  ): Promise<MembershipRecord> {
    const { rows } = await db.query<MembershipRow>(
      `INSERT INTO memberships AS m (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [input.organizationId, input.userId, input.role],
    );
    return toRecord(rows[0]!);
  }

  /** The active membership of a user in an organization: the basis of every tenant check. */
  async findActive(
    db: Queryable,
    key: { organizationId: string; userId: string },
  ): Promise<MembershipRecord | undefined> {
    const { rows } = await db.query<MembershipRow>(
      `SELECT ${COLUMNS} FROM memberships m
       WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [key.organizationId, key.userId],
    );
    return rows[0] && toRecord(rows[0]);
  }

  /** Whether the user with this email is an active member, without saying whether they exist. */
  async isActiveMemberByEmail(
    db: Queryable,
    key: { organizationId: string; email: string },
  ): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1 FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND u.email = $2 AND m.status = 'active'`,
      [key.organizationId, key.email],
    );
    return rows.length > 0;
  }

  /** Locks the row for the rest of the transaction. */
  async findActiveByIdForUpdate(
    db: Queryable,
    key: { id: string; organizationId: string },
  ): Promise<MembershipRecord | undefined> {
    const { rows } = await db.query<MembershipRow>(
      `SELECT ${COLUMNS} FROM memberships m
       WHERE m.id = $1 AND m.organization_id = $2 AND m.status = 'active'
       FOR UPDATE`,
      [key.id, key.organizationId],
    );
    return rows[0] && toRecord(rows[0]);
  }

  /**
   * Locks the active owners of an organization, always in the same order, and
   * returns how many there are. Any change that could remove an owner takes
   * this lock first, so two owners demoting each other at the same time
   * cannot leave the organization without one.
   */
  async lockOwners(db: Queryable, organizationId: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT id FROM memberships
       WHERE organization_id = $1 AND role = 'OWNER' AND status = 'active'
       ORDER BY id
       FOR UPDATE`,
      [organizationId],
    );
    return rows.length;
  }

  async listActive(db: Queryable, organizationId: string): Promise<MemberRecord[]> {
    const { rows } = await db.query<MemberRow>(
      `SELECT ${COLUMNS}, u.email, u.display_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.status = 'active'
       ORDER BY m.created_at`,
      [organizationId],
    );
    return rows.map((row) => ({
      ...toRecord(row),
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
    }));
  }

  async countActive(db: Queryable, organizationId: string): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      "SELECT count(*) FROM memberships WHERE organization_id = $1 AND status = 'active'",
      [organizationId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async updateRole(
    db: Queryable,
    key: { id: string; organizationId: string },
    role: Role,
  ): Promise<void> {
    await db.query('UPDATE memberships SET role = $3 WHERE id = $1 AND organization_id = $2', [
      key.id,
      key.organizationId,
      role,
    ]);
  }

  async remove(db: Queryable, key: { id: string; organizationId: string }): Promise<void> {
    await db.query(
      "UPDATE memberships SET status = 'removed' WHERE id = $1 AND organization_id = $2",
      [key.id, key.organizationId],
    );
  }

  /** Active memberships of a user, oldest first. */
  async listForUser(db: Queryable, userId: string): Promise<UserMembership[]> {
    const { rows } = await db.query<UserMembershipRow>(
      `SELECT m.role, m.created_at AS joined_at, o.id, o.name, o.slug, o.created_at
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.status = 'active'
       ORDER BY m.created_at`,
      [userId],
    );
    return rows.map((row) => ({
      role: row.role,
      joinedAt: row.joined_at,
      organization: { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at },
    }));
  }
}

function toRecord(row: MembershipRow): MembershipRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
  };
}
