import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysRepository } from './api-keys.repository.js';
import { ApiKeysService } from './api-keys.service.js';

/** Imported by AuthModule, whose guard authenticates bearer keys through ApiKeysService. */
@Module({
  imports: [OrganizationsModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysRepository, ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
