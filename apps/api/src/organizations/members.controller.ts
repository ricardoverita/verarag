import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { MembersResponse } from '@verarag/contracts';
import type { Request } from 'express';

import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import {
  CurrentAccess,
  type OrganizationAccess,
  OrganizationAccessGuard,
  OrganizationRoles,
} from './organization-access.js';
import {
  membershipIdParam,
  membersResponse,
  toMemberView,
  type UpdateMemberRequest,
  updateMemberRequest,
} from './organizations.dto.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations/:organizationId/members')
@UseGuards(OrganizationAccessGuard)
export class MembersController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** Every member can see who else belongs to the organization. */
  @Get()
  @ResponseSchema(membersResponse)
  async list(@CurrentAccess() access: OrganizationAccess): Promise<MembersResponse> {
    const members = await this.organizations.listMembers(access);
    return { members: members.map(toMemberView) };
  }

  @Patch(':membershipId')
  @OrganizationRoles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @CurrentAccess() access: OrganizationAccess,
    @Param('membershipId', { schema: membershipIdParam }) membershipId: string,
    @Body({ schema: updateMemberRequest }) body: UpdateMemberRequest,
    @Req() req: Request,
  ): Promise<void> {
    await this.organizations.changeRole(access, membershipId, body.role, requestIdOf(req));
  }

  /** Removes a member. Any member may remove themselves, which is how they leave. */
  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAccess() access: OrganizationAccess,
    @Param('membershipId', { schema: membershipIdParam }) membershipId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.organizations.removeMember(access, membershipId, requestIdOf(req));
  }
}
