import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from '@verarag/contracts';
import type { Request } from 'express';

import type { ActionContext } from '../common/actor.js';
import { AppError } from '../common/app-error.js';
import { requestIdOf } from '../common/request-context.js';
import { Database } from '../database/database.js';
import { MembershipsRepository } from './memberships.repository.js';
import type { Role } from './roles.js';

/** What a signed-in member may do inside one organization, resolved from their membership. */
export interface OrganizationAccess {
  kind: 'member';
  organizationId: string;
  userId: string;
  membershipId: string;
  role: Role;
}

/** An API key acting inside the one organization it belongs to. Its scopes are its permissions. */
export interface ApiKeyAccess {
  kind: 'apiKey';
  organizationId: string;
  apiKeyId: string;
  scopes: ApiKeyScope[];
}

export type TenantAccess = OrganizationAccess | ApiKeyAccess;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      organizationAccess?: TenantAccess;
    }
  }
}

const ORGANIZATION_ROLES = 'verarag:organization-roles';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles allowed to call the route. Without it, any member may. */
export const OrganizationRoles = (...roles: Role[]) => SetMetadata(ORGANIZATION_ROLES, roles);

/**
 * The single place where tenant access is decided for HTTP routes with an
 * `:organizationId` parameter:
 *
 * - a signed-in user must have an active membership in that organization,
 *   with one of the roles in @OrganizationRoles if the route sets them;
 * - an API key must belong to that organization. Which routes it may call
 *   at all, and with which scopes, the global AuthGuard has already checked.
 *
 * Anyone else gets the same 404 as a missing organization, so ids cannot be
 * probed to learn which organizations exist.
 */
@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Database,
    private readonly memberships: MembershipsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const principal = req.principal;
    if (!principal) {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }

    const organizationId = req.params.organizationId;
    if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
      throw new AppError('ORGANIZATION_NOT_FOUND');
    }

    if (principal.kind === 'apiKey') {
      if (principal.organizationId !== organizationId) {
        throw new AppError('ORGANIZATION_NOT_FOUND');
      }
      req.organizationAccess = {
        kind: 'apiKey',
        organizationId,
        apiKeyId: principal.apiKeyId,
        scopes: principal.scopes,
      };
      return true;
    }

    const membership = await this.memberships.findActive(this.db, {
      organizationId,
      userId: principal.user.id,
    });
    if (!membership) {
      throw new AppError('ORGANIZATION_NOT_FOUND');
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ORGANIZATION_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(membership.role)) {
      throw new AppError('INSUFFICIENT_ROLE');
    }

    req.organizationAccess = {
      kind: 'member',
      organizationId,
      userId: principal.user.id,
      membershipId: membership.id,
      role: membership.role,
    };
    return true;
  }
}

function accessOf(context: ExecutionContext): TenantAccess {
  const access = context.switchToHttp().getRequest<Request>().organizationAccess;
  if (!access) {
    throw new Error('the route has no OrganizationAccessGuard');
  }
  return access;
}

/** The member's access, for routes only people can use. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationAccess => {
    const access = accessOf(context);
    if (access.kind !== 'member') {
      // Unreachable while the route has no @ApiKeyScopes: keys are stopped earlier.
      throw new AppError('INSUFFICIENT_SCOPE');
    }
    return access;
  },
);

/** The access of a member or an API key, for routes that accept both. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantAccess => accessOf(context),
);

/** Who is acting, in which organization and for which request. */
export function actionContext(access: TenantAccess, req: Request): ActionContext {
  return {
    organizationId: access.organizationId,
    actor:
      access.kind === 'member'
        ? { type: 'user', userId: access.userId }
        : { type: 'apiKey', apiKeyId: access.apiKeyId },
    requestId: requestIdOf(req),
  };
}
