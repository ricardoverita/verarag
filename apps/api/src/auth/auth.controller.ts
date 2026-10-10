import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { MeResponse, RegisterResponse } from '@verarag/contracts';
import type { Request, Response } from 'express';

import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import type { UserMembership } from '../organizations/memberships.repository.js';
import { toOrganizationView } from '../organizations/organization.views.js';
import { CurrentSession, OptionalPrincipal, Public } from './auth.decorators.js';
import {
  type LoginRequest,
  loginRequest,
  meResponse,
  type RegisterRequest,
  registerRequest,
  registerResponse,
  toUserView,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser, Principal, SessionPrincipal } from './principal.js';
import { SessionCookie } from './session-cookie.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookie: SessionCookie,
  ) {}

  /** Creates the account and its first organization, and signs in. */
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ResponseSchema(registerResponse, HttpStatus.CREATED)
  async register(
    @Body({ schema: registerRequest }) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterResponse> {
    const { user, organization, membership, session } = await this.auth.register(body, {
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

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseSchema(meResponse, HttpStatus.OK)
  async login(
    @Body({ schema: loginRequest }) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const { user, session } = await this.auth.login(body, {
      requestId: requestIdOf(req),
      previousToken: this.cookie.read(req),
    });
    this.cookie.write(res, session.token, session.expiresAt);
    return this.me(user, session.expiresAt, await this.auth.listMemberships(user));
  }

  /** Revokes the current session. Always clears the cookie, even if it was already invalid. */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @OptionalPrincipal() principal: Principal | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (principal?.kind === 'session') {
      await this.auth.logout(principal, requestIdOf(req));
    }
    this.cookie.clear(res);
  }

  /** The signed-in user and the organizations they belong to. */
  @Get('me')
  @ResponseSchema(meResponse)
  async currentUser(@CurrentSession() principal: SessionPrincipal): Promise<MeResponse> {
    return this.me(
      principal.user,
      principal.expiresAt,
      await this.auth.listMemberships(principal.user),
    );
  }

  private me(user: AuthenticatedUser, expiresAt: Date, memberships: UserMembership[]): MeResponse {
    return {
      user: toUserView(user),
      memberships: memberships.map((membership) => ({
        organization: toOrganizationView(membership.organization),
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      })),
      session: { expiresAt: expiresAt.toISOString() },
    };
  }
}
