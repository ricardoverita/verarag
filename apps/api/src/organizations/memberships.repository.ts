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

interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: Role;
  created_at: Date;
}

/**
 * Memberships always belong to an organization, so every query takes the
 * organization id: there is no way to look one up by its id alone.
 */
@Injectable()
export class MembershipsRepository {
  async insert(
    db: Queryable,
    input: { organizationId: string; userId: string; role: Role },
  ): Promise<MembershipRecord> {
    const { rows } = await db.query<MembershipRow>(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, organization_id, user_id, role, created_at`,
      [input.organizationId, input.userId, input.role],
    );
    return toRecord(rows[0]!);
  }

  /** Active memberships of a user, oldest first. The basis of every tenant check. */
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

export interface UserMembership {
  role: Role;
  joinedAt: Date;
  organization: OrganizationRecord;
}

interface UserMembershipRow {
  role: Role;
  joined_at: Date;
  id: string;
  name: string;
  slug: string;
  created_at: Date;
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
