import { Module } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { HealthController } from './health.controller.js';
import { SystemStatusService } from './system-status.service.js';
import { SystemController } from './system.controller.js';

@Module({
  imports: [MessagingModule, StorageModule],
  controllers: [HealthController, SystemController],
  providers: [SystemStatusService],
})
export class HealthModule {}
