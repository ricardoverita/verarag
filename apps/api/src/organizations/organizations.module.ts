import { Module } from '@nestjs/common';

import { MembershipsRepository } from './memberships.repository.js';
import { OrganizationsRepository } from './organizations.repository.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  providers: [OrganizationsRepository, MembershipsRepository, OrganizationsService],
  exports: [OrganizationsService, MembershipsRepository],
})
export class OrganizationsModule {}
