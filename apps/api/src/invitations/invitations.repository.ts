import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';
import type { OrganizationRecord } from '../organizations/organizations.repository.js';
import type { Role } from '../organizations/roles.js';

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  invitedBy: { id: string; displayName: string };
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** An invitation found by its token, with the organization it leads to. */
export interface InvitationWithOrganization extends InvitationRecord {
  organization: OrganizationRecord;
}

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: Role;
  invited_by_user_id: string;
  inviter_display_name: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

interface InvitationWithOrganizationRow extends InvitationRow {
  organization_name: string;
  organization_slug: string;
  organization_created_at: Date;
}

const COLUMNS = `i.id, i.organization_id, i.email, i.role, i.invited_by_user_id,
  inviter.display_name AS inviter_display_name,
  i.created_at, i.expires_at, i.accepted_at, i.revoked_at`;

const OPEN = 'i.accepted_at IS NULL AND i.revoked_at IS NULL';

/**
 * Invitations belong to an organization: management queries take its id.
 * The only lookups without it are by token hash, for the person who holds
 * the link and is not a member yet.
 */
@Injectable()
export class InvitationsRepository {
  async insert(
    db: Queryable,
    input: {
      organizationId: string;
      email: string;
      role: Role;
      tokenHash: Buffer;
      invitedByUserId: string;
      expiresAt: Date;
    },
  ): Promise<InvitationRecord> {
    const { rows } = await db.query<InvitationRow>(
      `WITH i AS (
         INSERT INTO invitations (organization_id, email, role, token_hash, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *
       )
       SELECT ${COLUMNS} FROM i JOIN users inviter ON inviter.id = i.invited_by_user_id`,
      [
        input.organizationId,
        input.email,
        input.role,
        input.tokenHash,
        input.invitedByUserId,
        input.expiresAt,
      ],
    );
    return toRecord(rows[0]!);
  }

  /**
   * Serializes invitations to the same email in the same organization until
   * the transaction ends, so two concurrent invitations cannot both end up
   * open. Without a lock, the second insert would hit invitations_open_key.
   */
  async lockEmail(db: Queryable, key: { organizationId: string; email: string }): Promise<void> {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [
      key.organizationId,
      key.email,
    ]);
  }

  /** Revokes the open invitation for this email, if there is one, and returns its id. */
  async revokeOpenForEmail(
    db: Queryable,
    key: { organizationId: string; email: string },
  ): Promise<string | undefined> {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE invitations i SET revoked_at = now()
       WHERE i.organization_id = $1 AND i.email = $2 AND ${OPEN}
       RETURNING i.id`,
      [key.organizationId, key.email],
    );
    return rows[0]?.id;
  }

  /** Pending and expired invitations, newest first. Accepted and revoked ones are history. */
  async listOpen(db: Queryable, organizationId: string): Promise<InvitationRecord[]> {
    const { rows } = await db.query<InvitationRow>(
      `SELECT ${COLUMNS}
       FROM invitations i JOIN users inviter ON inviter.id = i.invited_by_user_id
       WHERE i.organization_id = $1 AND ${OPEN}
       ORDER BY i.created_at DESC`,
      [organizationId],
    );
    return rows.map(toRecord);
  }

  async findByIdForUpdate(
    db: Queryable,
    key: { id: string; organizationId: string },
  ): Promise<InvitationRecord | undefined> {
    const { rows } = await db.query<InvitationRow>(
      `SELECT ${COLUMNS}
       FROM invitations i JOIN users inviter ON inviter.id = i.invited_by_user_id
       WHERE i.id = $1 AND i.organization_id = $2
       FOR UPDATE OF i`,
      [key.id, key.organizationId],
    );
    return rows[0] && toRecord(rows[0]);
  }

  /**
   * Finds an invitation by the hash of its token. With `forUpdate`, the row
   * stays locked until the transaction ends, so the same link cannot be
   * accepted twice at the same time.
   */
  async findByTokenHash(
    db: Queryable,
    tokenHash: Buffer,
    options: { forUpdate?: boolean } = {},
  ): Promise<InvitationWithOrganization | undefined> {
    const { rows } = await db.query<InvitationWithOrganizationRow>(
      `SELECT ${COLUMNS},
         o.name AS organization_name, o.slug AS organization_slug,
         o.created_at AS organization_created_at
       FROM invitations i
       JOIN users inviter ON inviter.id = i.invited_by_user_id
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = $1
       ${options.forUpdate ? 'FOR UPDATE OF i' : ''}`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      ...toRecord(row),
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        slug: row.organization_slug,
        createdAt: row.organization_created_at,
      },
    };
  }

  async revoke(db: Queryable, key: { id: string; organizationId: string }): Promise<void> {
    await db.query(
      'UPDATE invitations SET revoked_at = now() WHERE id = $1 AND organization_id = $2',
      [key.id, key.organizationId],
    );
  }

  async markAccepted(
    db: Queryable,
    key: { id: string; organizationId: string },
    userId: string,
  ): Promise<void> {
    await db.query(
      `UPDATE invitations SET accepted_at = now(), accepted_by_user_id = $3
       WHERE id = $1 AND organization_id = $2`,
      [key.id, key.organizationId, userId],
    );
  }
}

function toRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    invitedBy: { id: row.invited_by_user_id, displayName: row.inviter_display_name },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}
