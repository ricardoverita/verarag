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
import type { ApiKeysResponse, CreatedApiKeyResponse } from '@verarag/contracts';
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
  apiKeyIdParam,
  apiKeysResponse,
  type CreateApiKeyRequest,
  createApiKeyRequest,
  createdApiKeyResponse,
  toApiKeyView,
} from './api-keys.dto.js';
import { ApiKeysService } from './api-keys.service.js';

/** API keys of one organization, managed by its owners and admins with a session. */
@Controller('organizations/:organizationId/api-keys')
@UseGuards(OrganizationAccessGuard)
@OrganizationRoles('OWNER', 'ADMIN')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(createdApiKeyResponse)
  async create(
    @CurrentAccess() access: OrganizationAccess,
    @Body({ schema: createApiKeyRequest }) body: CreateApiKeyRequest,
    @Req() req: Request,
  ): Promise<CreatedApiKeyResponse> {
    const { apiKey, key } = await this.apiKeys.create(access, body, requestIdOf(req));
    return { apiKey: toApiKeyView(apiKey), key };
  }

  @Get()
  @ResponseSchema(apiKeysResponse)
  async list(@CurrentAccess() access: OrganizationAccess): Promise<ApiKeysResponse> {
    const apiKeys = await this.apiKeys.list(access);
    const now = new Date();
    return { apiKeys: apiKeys.map((apiKey) => toApiKeyView(apiKey, now)) };
  }

  @Delete(':apiKeyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentAccess() access: OrganizationAccess,
    @Param('apiKeyId', { schema: apiKeyIdParam }) apiKeyId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.apiKeys.revoke(access, apiKeyId, requestIdOf(req));
  }
}
