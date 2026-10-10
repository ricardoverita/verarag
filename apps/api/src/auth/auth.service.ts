import { Injectable } from '@nestjs/common';

import { AuditLog } from '../audit/audit-log.js';
import { AppError } from '../common/app-error.js';
import { Database, isUniqueViolation } from '../database/database.js';
import type { MembershipRecord } from '../organizations/memberships.repository.js';
import type { OrganizationRecord } from '../organizations/organizations.repository.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import type { RegisterRequest } from './auth.dto.js';
import { PasswordHasher } from './password-hasher.js';
import { type UserRecord, UsersRepository } from './users.repository.js';

export interface Registration {
  user: UserRecord;
  organization: OrganizationRecord;
  membership: MembershipRecord;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly organizations: OrganizationsService,
    private readonly passwords: PasswordHasher,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Creates the user, their first organization and the OWNER membership in
   * one transaction: either all three exist afterwards or none does.
   */
  async register(input: RegisterRequest, requestId?: string): Promise<Registration> {
    // Hashing takes a few hundred milliseconds; do it before taking a connection.
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.db.transaction(async (tx) => {
        const user = await this.users.insert(tx, {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
        });
        const { organization, membership } = await this.organizations.createForUser(tx, {
          userId: user.id,
          name: input.organizationName,
          requestId,
        });
        await this.audit.record(tx, {
          action: 'USER_REGISTERED',
          actorUserId: user.id,
          organizationId: organization.id,
          resourceType: 'user',
          resourceId: user.id,
          metadata: { requestId: requestId ?? null },
        });
        return { user, organization, membership };
      });
    } catch (error) {
      // Saying that the email exists is unavoidable without email
      // verification; the endpoint's rate limit keeps enumeration slow.
      if (isUniqueViolation(error, 'users_email_key')) {
        throw new AppError('EMAIL_UNAVAILABLE');
      }
      throw error;
    }
  }
}
