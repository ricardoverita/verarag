import { Inject, Injectable } from '@nestjs/common';

import { AuditLog } from '../audit/audit-log.js';
import { AuthService, type RequestContext } from '../auth/auth.service.js';
import { PasswordHasher } from '../auth/password-hasher.js';
import type { AuthenticatedUser } from '../auth/principal.js';
import type { StartedSession } from '../auth/session.service.js';
import { type UserRecord, UsersRepository } from '../auth/users.repository.js';
import { AppError } from '../common/app-error.js';
import { generateToken, hashToken } from '../common/tokens.js';
import { CONFIG, type Config } from '../config/config.js';
import { Database, isUniqueViolation, type Queryable } from '../database/database.js';
import { MetricsService } from '../observability/metrics.service.js';
import { assertCanInvite } from '../organizations/membership-rules.js';
import {
  type MembershipRecord,
  MembershipsRepository,
} from '../organizations/memberships.repository.js';
import type { OrganizationAccess } from '../organizations/organization-access.js';
import type { OrganizationRecord } from '../organizations/organizations.repository.js';
import type { Role } from '../organizations/roles.js';
import { assertUsable } from './invitation-rules.js';
import {
  type InvitationRecord,
  InvitationsRepository,
  type InvitationWithOrganization,
} from './invitations.repository.js';

export interface CreatedInvitation {
  invitation: InvitationRecord;
  /** The only time the token exists outside the invitee's hands. */
  inviteUrl: string;
}

export interface AcceptedInvitation {
  organization: OrganizationRecord;
  membership: MembershipRecord;
}

export interface InvitedRegistration extends AcceptedInvitation {
  user: UserRecord;
  session: StartedSession;
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: Database,
    private readonly invitations: InvitationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordHasher,
    private readonly auth: AuthService,
    private readonly audit: AuditLog,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Creates an invitation and returns its link once. Inviting an email that
   * already has an open invitation replaces it, which is also how a lost
   * link is resent: the old link stops working.
   */
  async create(
    access: OrganizationAccess,
    input: { email: string; role: Role },
    requestId?: string,
  ): Promise<CreatedInvitation> {
    assertCanInvite(access.role, input.role);
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.config.invitations.ttlHours * 3_600_000);
    const key = { organizationId: access.organizationId, email: input.email };

    const invitation = await this.db.transaction(async (tx) => {
      await this.invitations.lockEmail(tx, key);
      if (await this.memberships.isActiveMemberByEmail(tx, key)) {
        throw new AppError('ALREADY_A_MEMBER');
      }
      const replaced = await this.invitations.revokeOpenForEmail(tx, key);
      const created = await this.invitations.insert(tx, {
        ...key,
        role: input.role,
        tokenHash: hashToken(token),
        invitedByUserId: access.userId,
        expiresAt,
      });
      await this.audit.record(tx, {
        action: 'MEMBER_INVITED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'invitation',
        resourceId: created.id,
        metadata: { role: input.role, replaced: replaced ?? null, requestId: requestId ?? null },
      });
      return created;
    });
    this.metrics.invitationsCreated.inc();
    return { invitation, inviteUrl: this.inviteUrl(token) };
  }

  list(access: OrganizationAccess): Promise<InvitationRecord[]> {
    return this.invitations.listOpen(this.db, access.organizationId);
  }

  /** Cancels an invitation. Cancelling one that is already cancelled does nothing. */
  async revoke(
    access: OrganizationAccess,
    invitationId: string,
    requestId?: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const invitation = await this.invitations.findByIdForUpdate(tx, {
        id: invitationId,
        organizationId: access.organizationId,
      });
      if (!invitation) {
        throw new AppError('INVITATION_NOT_FOUND');
      }
      assertCanInvite(access.role, invitation.role);
      if (invitation.acceptedAt) {
        throw new AppError('INVITATION_ALREADY_USED');
      }
      if (invitation.revokedAt) return;

      await this.invitations.revoke(tx, invitation);
      await this.audit.record(tx, {
        action: 'INVITATION_REVOKED',
        organizationId: access.organizationId,
        actorUserId: access.userId,
        resourceType: 'invitation',
        resourceId: invitation.id,
        metadata: { requestId: requestId ?? null },
      });
    });
  }

  /** What the link leads to. Anyone holding the token may see it, signed in or not. */
  async preview(token: string): Promise<InvitationWithOrganization> {
    const invitation = await this.invitations.findByTokenHash(this.db, hashToken(token));
    if (!invitation) {
      throw new AppError('INVITATION_NOT_FOUND');
    }
    assertUsable(invitation, new Date());
    return invitation;
  }

  /** Joins the organization as the signed-in user, who must own the invited email. */
  async accept(
    token: string,
    user: AuthenticatedUser,
    requestId?: string,
  ): Promise<AcceptedInvitation> {
    const accepted = await this.db.transaction(async (tx) => {
      const invitation = await this.lockUsable(tx, token);
      if (invitation.email !== user.email) {
        throw new AppError('INVITATION_EMAIL_MISMATCH');
      }
      const existing = await this.memberships.findActive(tx, {
        organizationId: invitation.organizationId,
        userId: user.id,
      });
      if (existing) {
        throw new AppError('ALREADY_A_MEMBER');
      }
      const membership = await this.join(tx, invitation, user.id, requestId);
      return { organization: invitation.organization, membership };
    });
    this.metrics.invitationsAccepted.inc({ account: 'existing' });
    return accepted;
  }

  /**
   * Creates an account for the invited email and joins the organization, in
   * one transaction with the session: either all of it happens or none.
   * Unlike a normal sign-up, no organization of their own is created.
   */
  async register(
    input: { token: string; displayName: string; password: string },
    context: RequestContext,
  ): Promise<InvitedRegistration> {
    // Fail fast on bad links before spending a password hash on them.
    await this.preview(input.token);
    const passwordHash = await this.passwords.hash(input.password);

    try {
      const registration = await this.db.transaction(async (tx) => {
        const invitation = await this.lockUsable(tx, input.token);
        const user = await this.users.insert(tx, {
          email: invitation.email,
          passwordHash,
          displayName: input.displayName,
        });
        await this.audit.record(tx, {
          action: 'USER_REGISTERED',
          actorUserId: user.id,
          organizationId: invitation.organizationId,
          resourceType: 'user',
          resourceId: user.id,
          metadata: { invitation: invitation.id, requestId: context.requestId ?? null },
        });
        const membership = await this.join(tx, invitation, user.id, context.requestId);
        const session = await this.auth.startSession(tx, user.id, context);
        return { user, organization: invitation.organization, membership, session };
      });
      this.metrics.invitationsAccepted.inc({ account: 'new' });
      return registration;
    } catch (error) {
      // The invitee already has an account: they should sign in and accept.
      if (isUniqueViolation(error, 'users_email_key')) {
        throw new AppError('EMAIL_UNAVAILABLE');
      }
      throw error;
    }
  }

  private async lockUsable(tx: Queryable, token: string): Promise<InvitationWithOrganization> {
    const invitation = await this.invitations.findByTokenHash(tx, hashToken(token), {
      forUpdate: true,
    });
    if (!invitation) {
      throw new AppError('INVITATION_NOT_FOUND');
    }
    assertUsable(invitation, new Date());
    return invitation;
  }

  private async join(
    tx: Queryable,
    invitation: InvitationRecord,
    userId: string,
    requestId?: string,
  ): Promise<MembershipRecord> {
    const membership = await this.memberships.insert(tx, {
      organizationId: invitation.organizationId,
      userId,
      role: invitation.role,
    });
    await this.invitations.markAccepted(tx, invitation, userId);
    await this.audit.record(tx, {
      action: 'INVITATION_ACCEPTED',
      organizationId: invitation.organizationId,
      actorUserId: userId,
      resourceType: 'invitation',
      resourceId: invitation.id,
      metadata: { role: invitation.role, membership: membership.id, requestId: requestId ?? null },
    });
    return membership;
  }

  private inviteUrl(token: string): string {
    const base = this.config.web.publicUrl.endsWith('/')
      ? this.config.web.publicUrl
      : `${this.config.web.publicUrl}/`;
    return new URL(`invitations/${token}`, base).toString();
  }
}
