import { Module } from '@nestjs/common';

import { CollectionsModule } from '../collections/collections.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { StorageModule } from '../storage/storage.module.js';
import {
  CollectionDocumentsController,
  DocumentsController,
  UploadPolicyController,
} from './documents.controller.js';
import { DocumentsMetrics } from './documents.metrics.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [OrganizationsModule, CollectionsModule, StorageModule],
  controllers: [CollectionDocumentsController, DocumentsController, UploadPolicyController],
  providers: [DocumentsRepository, DocumentsService, DocumentsMetrics],
})
export class DocumentsModule {}
