import { Injectable } from '@nestjs/common';

import { AuditLog } from '../audit/audit-log.js';
import type { Queryable } from '../database/database.js';
import { type MembershipRecord, MembershipsRepository } from './memberships.repository.js';
import { type OrganizationRecord, OrganizationsRepository } from './organizations.repository.js';

@Injectable()
export class OrganizationsService {
  constructor(
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
}
