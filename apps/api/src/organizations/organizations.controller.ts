import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { MembershipSummary, OrganizationDetail } from '@verarag/contracts';
import type { Request } from 'express';

import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/principal.js';
import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import { toOrganizationView } from './organization.views.js';
import {
  CurrentAccess,
  type OrganizationAccess,
  OrganizationAccessGuard,
  OrganizationRoles,
} from './organization-access.js';
import {
  type CreateOrganizationRequest,
  createOrganizationRequest,
  membershipSummary,
  organizationDetail,
  organizationsResponse,
  toMembershipSummary,
  type UpdateOrganizationRequest,
  updateOrganizationRequest,
} from './organizations.dto.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** Creates another organization with the caller as its OWNER. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(membershipSummary)
  async create(
    @Body({ schema: createOrganizationRequest }) body: CreateOrganizationRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MembershipSummary> {
    const { organization, membership } = await this.organizations.create(
      user.id,
      body.name,
      requestIdOf(req),
    );
    return {
      organization: toOrganizationView(organization),
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  /** Only the organizations where the caller has an active membership. */
  @Get()
  @ResponseSchema(organizationsResponse)
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ organizations: MembershipSummary[] }> {
    const memberships = await this.organizations.listForUser(user.id);
    return { organizations: memberships.map(toMembershipSummary) };
  }

  @Get(':organizationId')
  @UseGuards(OrganizationAccessGuard)
  @ResponseSchema(organizationDetail)
  async get(@CurrentAccess() access: OrganizationAccess): Promise<OrganizationDetail> {
    const { organization, memberCount } = await this.organizations.detail(access);
    return { organization: toOrganizationView(organization), role: access.role, memberCount };
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationAccessGuard)
  @OrganizationRoles('OWNER', 'ADMIN')
  @ResponseSchema(organizationDetail)
  async update(
    @CurrentAccess() access: OrganizationAccess,
    @Body({ schema: updateOrganizationRequest }) body: UpdateOrganizationRequest,
    @Req() req: Request,
  ): Promise<OrganizationDetail> {
    await this.organizations.rename(access, body.name, requestIdOf(req));
    return this.get(access);
  }
}
