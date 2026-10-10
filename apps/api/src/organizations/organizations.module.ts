import { Module } from '@nestjs/common';

import { MembersController } from './members.controller.js';
import { MembershipsRepository } from './memberships.repository.js';
import { OrganizationAccessGuard } from './organization-access.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsMetrics } from './organizations.metrics.js';
import { OrganizationsRepository } from './organizations.repository.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  controllers: [OrganizationsController, MembersController],
  providers: [
    OrganizationsRepository,
    MembershipsRepository,
    OrganizationsService,
    OrganizationAccessGuard,
    OrganizationsMetrics,
  ],
  exports: [OrganizationsService, MembershipsRepository, OrganizationAccessGuard],
})
export class OrganizationsModule {}
