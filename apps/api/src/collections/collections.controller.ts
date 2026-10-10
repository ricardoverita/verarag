import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import type { CollectionsResponse, CollectionView } from '@verarag/contracts';
import type { Request } from 'express';

import { ApiKeyScopes } from '../auth/auth.decorators.js';
import { ResponseSchema } from '../common/response-schema.js';
import {
  actionContext,
  CurrentTenant,
  OrganizationAccessGuard,
  OrganizationRoles,
  type TenantAccess,
} from '../organizations/organization-access.js';
import {
  collectionIdParam,
  collectionsResponse,
  collectionView,
  type CreateCollectionRequest,
  createCollectionRequest,
  toCollectionView,
  type UpdateCollectionRequest,
  updateCollectionRequest,
} from './collections.dto.js';
import { CollectionsService } from './collections.service.js';

/**
 * Every member sees the collections; owners and admins manage them. API keys
 * of the organization need collections:read or collections:write.
 */
@ApiTags('collections')
@Controller('organizations/:organizationId/collections')
@UseGuards(OrganizationAccessGuard)
@ApiParam({ name: 'organizationId', format: 'uuid' })
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Post()
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiKeyScopes('collections:write')
  @ResponseSchema(collectionView, HttpStatus.CREATED)
  async create(
    @CurrentTenant() access: TenantAccess,
    @Body({ schema: createCollectionRequest }) body: CreateCollectionRequest,
    @Req() req: Request,
  ): Promise<CollectionView> {
    return toCollectionView(await this.collections.create(actionContext(access, req), body));
  }

  @Get()
  @ApiKeyScopes('collections:read')
  @ResponseSchema(collectionsResponse)
  async list(@CurrentTenant() access: TenantAccess): Promise<CollectionsResponse> {
    const collections = await this.collections.list(access.organizationId);
    return { collections: collections.map(toCollectionView) };
  }

  @Get(':collectionId')
  @ApiKeyScopes('collections:read')
  @ResponseSchema(collectionView)
  async get(
    @CurrentTenant() access: TenantAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
  ): Promise<CollectionView> {
    return toCollectionView(await this.collections.get(access.organizationId, collectionId));
  }

  @Patch(':collectionId')
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiKeyScopes('collections:write')
  @ResponseSchema(collectionView)
  async update(
    @CurrentTenant() access: TenantAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
    @Body({ schema: updateCollectionRequest }) body: UpdateCollectionRequest,
    @Req() req: Request,
  ): Promise<CollectionView> {
    return toCollectionView(
      await this.collections.update(actionContext(access, req), collectionId, body),
    );
  }

  @Delete(':collectionId')
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiKeyScopes('collections:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentTenant() access: TenantAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.collections.delete(actionContext(access, req), collectionId);
  }
}
