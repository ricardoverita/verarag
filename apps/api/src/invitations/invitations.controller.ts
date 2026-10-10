import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { CreatedInvitationResponse, InvitationsResponse } from '@verarag/contracts';
import type { Request } from 'express';

import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import {
  CurrentAccess,
  type OrganizationAccess,
  OrganizationAccessGuard,
  OrganizationRoles,
} from '../organizations/organization-access.js';
import {
  type CreateInvitationRequest,
  createdInvitationResponse,
  createInvitationRequest,
  invitationIdParam,
  invitationsResponse,
  toInvitationView,
} from './invitations.dto.js';
import { InvitationsService } from './invitations.service.js';

/** Invitations of one organization, managed by its owners and admins. */
@Controller('organizations/:organizationId/invitations')
@UseGuards(OrganizationAccessGuard)
@OrganizationRoles('OWNER', 'ADMIN')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(createdInvitationResponse)
  async create(
    @CurrentAccess() access: OrganizationAccess,
    @Body({ schema: createInvitationRequest }) body: CreateInvitationRequest,
    @Req() req: Request,
  ): Promise<CreatedInvitationResponse> {
    const { invitation, inviteUrl } = await this.invitations.create(access, body, requestIdOf(req));
    return { invitation: toInvitationView(invitation), inviteUrl };
  }

  /** Invitations still waiting for an answer, including expired ones. Never their links. */
  @Get()
  @ResponseSchema(invitationsResponse)
  async list(@CurrentAccess() access: OrganizationAccess): Promise<InvitationsResponse> {
    const invitations = await this.invitations.list(access);
    const now = new Date();
    return { invitations: invitations.map((invitation) => toInvitationView(invitation, now)) };
  }

  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentAccess() access: OrganizationAccess,
    @Param('invitationId', { schema: invitationIdParam }) invitationId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.invitations.revoke(access, invitationId, requestIdOf(req));
  }
}
