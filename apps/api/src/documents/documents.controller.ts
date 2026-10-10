import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiParam, ApiTags } from '@nestjs/swagger';
import type { DocumentsResponse, DocumentView, UploadPolicy } from '@verarag/contracts';
import type { Request, Response } from 'express';

import { collectionIdParam } from '../collections/collections.dto.js';
import type { ActionContext } from '../common/actor.js';
import { requestIdOf } from '../common/request-context.js';
import { ResponseSchema } from '../common/response-schema.js';
import { CONFIG, type Config } from '../config/config.js';
import {
  CurrentAccess,
  type OrganizationAccess,
  OrganizationAccessGuard,
  OrganizationRoles,
} from '../organizations/organization-access.js';
import { DOCUMENT_TYPES } from './document-types.js';
import {
  documentIdParam,
  documentsResponse,
  documentView,
  toDocumentView,
  toUploadPolicy,
  uploadPolicy,
} from './documents.dto.js';
import { DocumentsService } from './documents.service.js';
import { FILE_FIELD } from './multipart.js';

const SUPPORTED = DOCUMENT_TYPES.map(
  (type) => `${type.mediaType} (${type.extensions.join(', ')})`,
).join('; ');

/** Documents inside one collection: listing them and uploading new ones. */
@ApiTags('documents')
@Controller('organizations/:organizationId/collections/:collectionId/documents')
@UseGuards(OrganizationAccessGuard)
@ApiParam({ name: 'organizationId', format: 'uuid' })
export class CollectionDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ResponseSchema(documentsResponse)
  async list(
    @CurrentAccess() access: OrganizationAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
  ): Promise<DocumentsResponse> {
    const documents = await this.documents.list(access.organizationId, collectionId);
    return { documents: documents.map(toDocumentView) };
  }

  /**
   * Streams the file to object storage without holding it in memory. Answers
   * once the file is stored, with the document AVAILABLE.
   */
  @Post()
  @OrganizationRoles('OWNER', 'ADMIN')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [FILE_FIELD],
      properties: {
        [FILE_FIELD]: {
          type: 'string',
          format: 'binary',
          description: `Exactly one file. Supported: ${SUPPORTED}. The maximum size is in GET /api/v1/documents/upload-policy.`,
        },
      },
    },
  })
  @ResponseSchema(documentView, HttpStatus.CREATED)
  async upload(
    @CurrentAccess() access: OrganizationAccess,
    @Param('collectionId', { schema: collectionIdParam }) collectionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DocumentView> {
    try {
      return toDocumentView(await this.documents.upload(contextOf(access, req), collectionId, req));
    } catch (error) {
      closeUnreadUpload(req, res);
      throw error;
    }
  }
}

@ApiTags('documents')
@Controller('organizations/:organizationId/documents')
@UseGuards(OrganizationAccessGuard)
@ApiParam({ name: 'organizationId', format: 'uuid' })
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':documentId')
  @ResponseSchema(documentView)
  async get(
    @CurrentAccess() access: OrganizationAccess,
    @Param('documentId', { schema: documentIdParam }) documentId: string,
  ): Promise<DocumentView> {
    return toDocumentView(await this.documents.get(access.organizationId, documentId));
  }
}

@ApiTags('documents')
@Controller('documents')
export class UploadPolicyController {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  /** The maximum size and the accepted types, from the same settings the upload enforces. */
  @Get('upload-policy')
  @ResponseSchema(uploadPolicy)
  policy(): UploadPolicy {
    return toUploadPolicy(this.config.documents.maxSizeBytes);
  }
}

function contextOf(access: OrganizationAccess, req: Request): ActionContext {
  return {
    organizationId: access.organizationId,
    actor: { type: 'user', userId: access.userId },
    requestId: requestIdOf(req),
  };
}

/** How much of a refused upload is read and discarded before the connection is closed. */
const DRAIN_LIMIT_BYTES = 4 * 1024 * 1024;
const DRAIN_TIMEOUT_MS = 5_000;

/**
 * When an upload is refused before its body was read to the end, the error
 * answer goes out right away. Closing the connection at that point would
 * make many clients see a reset instead of the answer, and reading the rest
 * could mean reading gigabytes. So the remainder is read and discarded up to
 * 4 MiB or 5 seconds, and then the connection is closed.
 */
function closeUnreadUpload(req: Request, res: Response): void {
  if (req.complete) return;
  res.once('finish', () => {
    if (req.complete) return;
    let discarded = 0;
    const timer = setTimeout(() => req.destroy(), DRAIN_TIMEOUT_MS).unref();
    req.on('data', (chunk: Buffer) => {
      discarded += chunk.length;
      if (discarded > DRAIN_LIMIT_BYTES) {
        clearTimeout(timer);
        req.destroy();
      }
    });
    req.once('end', () => clearTimeout(timer));
    req.resume();
  });
}
