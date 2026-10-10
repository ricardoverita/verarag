import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from '@verarag/contracts';
import type { Request } from 'express';

import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { AppError } from '../common/app-error.js';
import { CONFIG, type Config } from '../config/config.js';
import { MetricsService } from '../observability/metrics.service.js';
import { API_KEY_SCOPES, IS_PUBLIC } from './auth.decorators.js';
import { SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route requires a valid session unless it is marked
 * with @Public(), so a new endpoint is protected by default. API keys are
 * accepted only on routes marked with @ApiKeyScopes().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly reflector: Reflector,
    private readonly cookie: SessionCookie,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeysService,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    this.checkOrigin(req);

    const isPublic = this.reflected<boolean>(IS_PUBLIC, context) ?? false;
    const apiKey = bearerToken(req);
    if (apiKey !== undefined) {
      return this.authenticateApiKey(req, apiKey, context, isPublic);
    }

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

  private async authenticateApiKey(
    req: Request,
    key: string,
    context: ExecutionContext,
    isPublic: boolean,
  ): Promise<boolean> {
    try {
      req.principal = await this.apiKeys.authenticate(key);
    } catch (error) {
      if (isPublic && error instanceof AppError) return true;
      throw error;
    }
    if (isPublic) return true;

    const required = this.reflected<ApiKeyScope[]>(API_KEY_SCOPES, context);
    const granted = req.principal.kind === 'apiKey' ? req.principal.scopes : [];
    if (!required?.every((scope) => granted.includes(scope))) {
      this.metrics.apiKeysRejected.inc({ reason: 'insufficient_scope' });
      throw new AppError('INSUFFICIENT_SCOPE');
    }
    return true;
  }

  private reflected<T>(key: string, context: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T | undefined>(key, [
      context.getHandler(),
      context.getClass(),
    ]);
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

/**
 * The key from `Authorization: Bearer <key>`. Other schemes are ignored, so
 * a proxy that adds Basic credentials in front of the API does not break it.
 */
function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !/^bearer\s/i.test(header)) return undefined;
  return header.replace(/^bearer\s+/i, '').trim();
}
