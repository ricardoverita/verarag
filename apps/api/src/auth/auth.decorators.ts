import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from '../common/app-error.js';
import type { AuthenticatedUser, Principal, SessionPrincipal } from './principal.js';

export const IS_PUBLIC = 'verarag:public';

/**
 * Every route requires a session unless it is marked public. Public routes
 * still get the principal when the request carries a valid session.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

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
