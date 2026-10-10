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

import type { ActionContext } from '../common/actor.js';
import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import {
  CurrentAccess,
  type OrganizationAccess,
  OrganizationAccessGuard,
  OrganizationRoles,
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

/** Every member sees the collections; owners and admins manage them. */
@ApiTags('collections')
@Controller('organizations/:organizationId/collections')
@UseGuards(OrganizationAccessGuard)
@ApiParam({ name: 'organizationId', format: 'uuid' })
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Post()
  @OrganizationRoles('OWNER', 'ADMIN')
  @ResponseSchema(collectionView, HttpStatus.CREATED)
  async create(
    @CurrentAccess() access: OrganizationAccess,
    @Body({ schema: createCollectionRequest }) body: CreateCollectionRequest,
    @Req() req: Request,
  ): Promise<CollectionView> {
    return toCollectionView(await this.collections.create(contextOf(access, req), body));
  }

  @Get()
  @ResponseSchema(collectionsResponse)
  async list(@CurrentAccess() access: OrganizationAccess): Promise<CollectionsResponse> {
    const collections = await this.collections.list(access.organizationId);
    return { collections: collections.map(toCollectionView) };
  }

  @Get(':collectionId')
  @ResponseSchema(collectionView)
  async get(
    @CurrentAccess() access: OrganizationAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
  ): Promise<CollectionView> {
    return toCollectionView(await this.collections.get(access.organizationId, collectionId));
  }

  @Patch(':collectionId')
  @OrganizationRoles('OWNER', 'ADMIN')
  @ResponseSchema(collectionView)
  async update(
    @CurrentAccess() access: OrganizationAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
    @Body({ schema: updateCollectionRequest }) body: UpdateCollectionRequest,
    @Req() req: Request,
  ): Promise<CollectionView> {
    return toCollectionView(
      await this.collections.update(contextOf(access, req), collectionId, body),
    );
  }

  @Delete(':collectionId')
  @OrganizationRoles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentAccess() access: OrganizationAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.collections.delete(contextOf(access, req), collectionId);
  }
}

function contextOf(access: OrganizationAccess, req: Request): ActionContext {
  return {
    organizationId: access.organizationId,
    actor: { type: 'user', userId: access.userId },
    requestId: requestIdOf(req),
  };
}
