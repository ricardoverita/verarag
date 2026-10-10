import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import type { ApiKeyScope } from '@verarag/contracts';
import type { Request } from 'express';

import { AppError } from '../common/app-error.js';
import type { AuthenticatedUser, Principal, SessionPrincipal } from './principal.js';

export const IS_PUBLIC = 'verarag:public';

/** Names of the security schemes in the OpenAPI document. */
export const SESSION_SECURITY = 'session';
export const API_KEY_SECURITY = 'apiKey';

/**
 * Every route requires a session unless it is marked public. Public routes
 * still get the principal when the request carries a valid session. The
 * empty requirement tells OpenAPI that the route needs no credentials.
 */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC, true), ApiSecurity({}));

export const API_KEY_SCOPES = 'verarag:api-key-scopes';

/**
 * Lets API keys call the route when they have all these scopes. Routes
 * without it only accept sessions, so keys stay limited to what is listed.
 */
export const ApiKeyScopes = (...scopes: ApiKeyScope[]) =>
  applyDecorators(
    SetMetadata(API_KEY_SCOPES, scopes),
    ApiSecurity(SESSION_SECURITY),
    ApiSecurity(API_KEY_SECURITY),
  );

/** The signed-in user. Only for routes that require a session. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (principal?.kind !== 'session') {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }
    return principal.user;
  },
);

/** The current browser session. Only for routes that require one. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionPrincipal => {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (principal?.kind !== 'session') {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }
    return principal;
  },
);

/** The principal if there is one. For public routes that behave differently when signed in. */
export const OptionalPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | undefined =>
    context.switchToHttp().getRequest<Request>().principal,
);
