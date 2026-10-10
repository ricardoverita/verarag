import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from '../common/app-error.js';
import { Database } from '../database/database.js';
import { MembershipsRepository } from './memberships.repository.js';
import type { Role } from './roles.js';

/** What a request may do inside one organization, resolved from its membership. */
export interface OrganizationAccess {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      organizationAccess?: OrganizationAccess;
    }
  }
}

const ORGANIZATION_ROLES = 'verarag:organization-roles';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles allowed to call the route. Without it, any member may. */
export const OrganizationRoles = (...roles: Role[]) => SetMetadata(ORGANIZATION_ROLES, roles);

/**
 * The single place where tenant access is decided for HTTP routes with an
 * `:organizationId` parameter: the signed-in user must have an active
 * membership in that organization, with one of the required roles.
 *
 * Non-members get the same 404 as a missing organization, so ids cannot be
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
    if (principal?.kind !== 'session') {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }

    const organizationId = req.params.organizationId;
    if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
      throw new AppError('ORGANIZATION_NOT_FOUND');
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
      organizationId,
      userId: principal.user.id,
      membershipId: membership.id,
      role: membership.role,
    };
    return true;
  }
}

/** The access resolved by OrganizationAccessGuard. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationAccess => {
    const access = context.switchToHttp().getRequest<Request>().organizationAccess;
    if (!access) {
      throw new Error('CurrentAccess used on a route without OrganizationAccessGuard');
    }
    return access;
  },
);
