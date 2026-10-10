import { Injectable } from '@nestjs/common';

import { AuditLog } from '../audit/audit-log.js';
import { AppError } from '../common/app-error.js';
import { Database, type Queryable } from '../database/database.js';
import {
  assertCanChangeRole,
  assertCanRemoveMember,
  assertOwnerRemains,
} from './membership-rules.js';
import {
  type MemberRecord,
  type MembershipRecord,
  MembershipsRepository,
  type UserMembership,
} from './memberships.repository.js';
import type { OrganizationAccess } from './organization-access.js';
import { type OrganizationRecord, OrganizationsRepository } from './organizations.repository.js';
import type { Role } from './roles.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: Database,
    private readonly organizations: OrganizationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Creates an organization with `userId` as its first OWNER. It runs inside
   * the caller's transaction, so registration can create the user, the
   * organization and the membership atomically.
   */
  async createForUser(
    tx: Queryable,
    input: { userId: string; name: string; requestId?: string },
  ): Promise<{ organization: OrganizationRecord; membership: MembershipRecord }> {
    const organization = await this.organizations.insert(tx, input.name);
    const membership = await this.memberships.insert(tx, {
      organizationId: organization.id,
      userId: input.userId,
      role: 'OWNER',
    });
    await this.audit.record(tx, {
      action: 'ORGANIZATION_CREATED',
      organizationId: organization.id,
      actorUserId: input.userId,
      resourceType: 'organization',
      resourceId: organization.id,
      metadata: { slug: organization.slug, requestId: input.requestId ?? null },
    });
    return { organization, membership };
  }

  create(
    userId: string,
    name: string,
    requestId?: string,
  ): Promise<{ organization: OrganizationRecord; membership: MembershipRecord }> {
    return this.db.transaction((tx) => this.createForUser(tx, { userId, name, requestId }));
  }

  listForUser(userId: string): Promise<UserMembership[]> {
    return this.memberships.listForUser(this.db, userId);
  }

  async detail(
    access: OrganizationAccess,
  ): Promise<{ organization: OrganizationRecord; memberCount: number }> {
    const [organization, memberCount] = await Promise.all([
      this.organizations.get(this.db, access.organizationId),
      this.memberships.countActive(this.db, access.organizationId),
    ]);
    return { organization, memberCount };
  }

  rename(
    access: OrganizationAccess,
    name: string,
    requestId?: string,
  ): Promise<OrganizationRecord> {
    return this.db.transaction(async (tx) => {
      const organization = await this.organizations.rename(tx, access.organizationId, name);
      await this.audit.record(tx, {
        action: 'ORGANIZATION_UPDATED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'organization',
        resourceId: access.organizationId,
        metadata: { requestId: requestId ?? null },
      });
      return organization;
    });
  }

  listMembers(access: OrganizationAccess): Promise<MemberRecord[]> {
    return this.memberships.listActive(this.db, access.organizationId);
  }

  changeRole(
    access: OrganizationAccess,
    membershipId: string,
    role: Role,
    requestId?: string,
  ): Promise<void> {
    return this.db.transaction(async (tx) => {
      const { target, owners } = await this.lockTarget(tx, access, membershipId);
      assertCanChangeRole(access.role, target.role, role);
      assertOwnerRemains(owners, target.role, role);
      if (target.role === role) return;

      await this.memberships.updateRole(
        tx,
        { id: target.id, organizationId: access.organizationId },
        role,
      );
      await this.audit.record(tx, {
        action: 'MEMBER_ROLE_CHANGED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'membership',
        resourceId: target.id,
        metadata: { from: target.role, to: role, requestId: requestId ?? null },
      });
    });
  }

  /** Removes a member, or lets the caller leave when it is their own membership. */
  removeMember(
    access: OrganizationAccess,
    membershipId: string,
    requestId?: string,
  ): Promise<void> {
    return this.db.transaction(async (tx) => {
      const { target, owners } = await this.lockTarget(tx, access, membershipId);
      assertCanRemoveMember(access, { membershipId: target.id, role: target.role });
      assertOwnerRemains(owners, target.role, 'removed');

      await this.memberships.remove(tx, { id: target.id, organizationId: access.organizationId });
      await this.audit.record(tx, {
        action: 'MEMBER_REMOVED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'membership',
        resourceId: target.id,
        metadata: {
          role: target.role,
          self: target.id === access.membershipId,
          requestId: requestId ?? null,
        },
      });
    });
  }

  /**
   * Locks the owners first and then the target membership, always in that
   * order, so concurrent changes serialize instead of deadlocking, and the
   * owner count stays true until the transaction ends.
   */
  private async lockTarget(
    tx: Queryable,
    access: OrganizationAccess,
    membershipId: string,
  ): Promise<{ target: MembershipRecord; owners: number }> {
    const owners = await this.memberships.lockOwners(tx, access.organizationId);
    const target = await this.memberships.findActiveByIdForUpdate(tx, {
      id: membershipId,
      organizationId: access.organizationId,
    });
    if (!target) {
      throw new AppError('MEMBER_NOT_FOUND');
    }
    return { target, owners };
  }
}
