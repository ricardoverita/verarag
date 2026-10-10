import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';
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
