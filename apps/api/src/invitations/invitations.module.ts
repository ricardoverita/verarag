import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { InvitationLinksController } from './invitation-links.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [InvitationsController, InvitationLinksController],
  providers: [InvitationsRepository, InvitationsService],
})
export class InvitationsModule {}
