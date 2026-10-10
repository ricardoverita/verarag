import { Body, Controller, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { InvitationPreview, MembershipSummary, RegisterResponse } from '@verarag/contracts';
import type { Request, Response } from 'express';

import { CurrentUser, Public } from '../auth/auth.decorators.js';
import { registerResponse, toUserView } from '../auth/auth.dto.js';
import type { AuthenticatedUser } from '../auth/principal.js';
import { SessionCookie } from '../auth/session-cookie.js';
import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import { toOrganizationView } from '../organizations/organization.views.js';
import { membershipSummary } from '../organizations/organizations.dto.js';
import {
  invitationPreview,
  invitationTokenRequest,
  type InvitationTokenRequest,
  registerWithInvitationRequest,
  type RegisterWithInvitationRequest,
  toInvitationPreview,
} from './invitations.dto.js';
import { InvitationsService } from './invitations.service.js';

/**
 * What the person holding an invitation link can do. The token always goes
 * in the request body, never in the path, so it stays out of access logs.
 * Tokens are 256-bit random values; the rate limits are defense in depth.
 */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationLinksController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookie: SessionCookie,
  ) {}

  @Post('preview')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ResponseSchema(invitationPreview, HttpStatus.OK)
  async preview(
    @Body({ schema: invitationTokenRequest }) body: InvitationTokenRequest,
  ): Promise<InvitationPreview> {
    return toInvitationPreview(await this.invitations.preview(body.token));
  }

  /** Accepts as the signed-in user. */
  @Post('accept')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseSchema(membershipSummary, HttpStatus.OK)
  async accept(
    @Body({ schema: invitationTokenRequest }) body: InvitationTokenRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MembershipSummary> {
    const { organization, membership } = await this.invitations.accept(
      body.token,
      user,
      requestIdOf(req),
    );
    return {
      organization: toOrganizationView(organization),
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  /** Accepts by creating an account for the invited email, and signs in. */
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ResponseSchema(registerResponse, HttpStatus.CREATED)
  async register(
    @Body({ schema: registerWithInvitationRequest }) body: RegisterWithInvitationRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterResponse> {
    const { user, organization, membership, session } = await this.invitations.register(body, {
      requestId: requestIdOf(req),
      previousToken: this.cookie.read(req),
    });
    this.cookie.write(res, session.token, session.expiresAt);
    return {
      user: toUserView(user),
      organization: toOrganizationView(organization),
      role: membership.role,
    };
  }
}
