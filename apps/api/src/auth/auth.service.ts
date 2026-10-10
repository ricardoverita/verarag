import { Injectable } from '@nestjs/common';

import { AuditLog } from '../audit/audit-log.js';
import { AppError } from '../common/app-error.js';
import { Database, isUniqueViolation } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import {
  type MembershipRecord,
  MembershipsRepository,
  type UserMembership,
} from '../organizations/memberships.repository.js';
import type { OrganizationRecord } from '../organizations/organizations.repository.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import type { LoginRequest, RegisterRequest } from './auth.dto.js';
import { LoginAttempts } from './login-attempts.js';
import { PasswordHasher } from './password-hasher.js';
import type { AuthenticatedUser, SessionPrincipal } from './principal.js';
import { SessionService, type StartedSession } from './session.service.js';
import { type UserRecord, UsersRepository } from './users.repository.js';

export interface Registration {
  user: UserRecord;
  organization: OrganizationRecord;
  membership: MembershipRecord;
  session: StartedSession;
}

export interface SignIn {
  user: UserRecord;
  session: StartedSession;
}

export interface RequestContext {
  requestId?: string;
  /** Session token the browser already had, if any. It is revoked on sign-in. */
  previousToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly memberships: MembershipsRepository,
    private readonly organizations: OrganizationsService,
    private readonly passwords: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly loginAttempts: LoginAttempts,
    private readonly audit: AuditLog,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Creates the user, their first organization, the OWNER membership and a
   * session in one transaction: either all of them exist afterwards or none.
   */
  async register(input: RegisterRequest, context: RequestContext): Promise<Registration> {
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
          requestId: context.requestId,
        });
        await this.audit.record(tx, {
          action: 'USER_REGISTERED',
          actorUserId: user.id,
          organizationId: organization.id,
          resourceType: 'user',
          resourceId: user.id,
          metadata: { requestId: context.requestId ?? null },
        });
        const session = await this.startSession(tx, user.id, context);
        return { user, organization, membership, session };
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

  /**
   * Checks the credentials and opens a new session. Unknown emails, disabled
   * users and wrong passwords all fail the same way and take the same time.
   */
  async login(input: LoginRequest, context: RequestContext): Promise<SignIn> {
    if (this.loginAttempts.isBlocked(input.email)) {
      this.metrics.loginFailures.inc({ reason: 'too_many_attempts' });
      throw new AppError('TOO_MANY_ATTEMPTS');
    }

    const user = await this.users.findByEmail(this.db, input.email);
    const check = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyAgainstDummy(input.password).then(() => undefined);
    if (!user || !check?.valid || user.status !== 'active') {
      this.loginAttempts.recordFailure(input.email);
      this.metrics.loginFailures.inc({ reason: 'invalid_credentials' });
      throw new AppError('INVALID_CREDENTIALS');
    }

    this.loginAttempts.reset(input.email);
    const newHash = check.needsRehash ? await this.passwords.hash(input.password) : undefined;
    const session = await this.db.transaction(async (tx) => {
      if (newHash) {
        await this.users.updatePasswordHash(tx, user.id, newHash);
      }
      await this.audit.record(tx, {
        action: 'USER_LOGGED_IN',
        actorUserId: user.id,
        resourceType: 'user',
        resourceId: user.id,
        metadata: { requestId: context.requestId ?? null },
      });
      return this.startSession(tx, user.id, context);
    });
    this.metrics.logins.inc();
    return { user, session };
  }

  async logout(principal: SessionPrincipal, requestId?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(tx, principal.sessionId);
      await this.audit.record(tx, {
        action: 'USER_LOGGED_OUT',
        actorUserId: principal.user.id,
        resourceType: 'session',
        resourceId: principal.sessionId,
        metadata: { requestId: requestId ?? null },
      });
    });
  }

  listMemberships(user: AuthenticatedUser): Promise<UserMembership[]> {
    return this.memberships.listForUser(this.db, user.id);
  }

  /**
   * Always a brand-new token, and any token the browser brought along is
   * revoked, so a session id planted before sign-in is worthless after it.
   * Every way of signing in goes through here.
   */
  async startSession(
    tx: Parameters<SessionService['start']>[0],
    userId: string,
    context: RequestContext,
  ): Promise<StartedSession> {
    if (context.previousToken) {
      await this.sessions.revokeToken(tx, context.previousToken);
    }
    return this.sessions.start(tx, userId);
  }
}
