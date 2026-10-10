import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from '../common/app-error.js';
import { CONFIG, type Config } from '../config/config.js';
import { IS_PUBLIC } from './auth.decorators.js';
import { SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route requires a valid session unless it is marked
 * with @Public(), so a new endpoint is protected by default.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly reflector: Reflector,
    private readonly cookie: SessionCookie,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    this.checkOrigin(req);

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const token = this.cookie.read(req);
    if (!token) {
      if (isPublic) return true;
      throw new AppError('AUTHENTICATION_REQUIRED');
    }

    try {
      req.principal = await this.sessions.authenticate(token);
    } catch (error) {
      // An expired cookie must not block public routes such as login.
      if (isPublic && error instanceof AppError) return true;
      throw error;
    }
    return true;
  }

  /**
   * Cross-site request forgery protection on top of SameSite cookies: a
   * browser always sends Origin with cross-site POST, PATCH or DELETE, and it
   * has to be the web app. Server-to-server calls send no Origin.
   */
  private checkOrigin(req: Request): void {
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && origin !== this.config.web.origin) {
      throw new AppError('FORBIDDEN_ORIGIN');
    }
  }
}
