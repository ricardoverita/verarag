import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { CollectionsController } from './collections.controller.js';
import { CollectionsMetrics } from './collections.metrics.js';
import { CollectionsRepository } from './collections.repository.js';
import { CollectionsService } from './collections.service.js';

@Module({
  imports: [OrganizationsModule],
  controllers: [CollectionsController],
  providers: [CollectionsRepository, CollectionsService, CollectionsMetrics],
  exports: [CollectionsRepository],
})
export class CollectionsModule {}
