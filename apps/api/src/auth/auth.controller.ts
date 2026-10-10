import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RegisterResponse } from '@verarag/contracts';
import type { Request } from 'express';

import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import { toOrganizationView } from '../organizations/organization.views.js';
import { type RegisterRequest, registerRequest, registerResponse, toUserView } from './auth.dto.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ResponseSchema(registerResponse)
  async register(
    @Body({ schema: registerRequest }) body: RegisterRequest,
    @Req() req: Request,
  ): Promise<RegisterResponse> {
    const { user, organization, membership } = await this.auth.register(body, requestIdOf(req));
    return {
      user: toUserView(user),
      organization: toOrganizationView(organization),
      role: membership.role,
    };
  }
}
