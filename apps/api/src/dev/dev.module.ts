import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { MessagingModule } from '../messaging/messaging.module.js';
import { DevEventsController } from './dev-events.controller.js';

/** Endpoints for local development and integration tests. Never enable them in production. */
@Module({
  imports: [MessagingModule],
  controllers: [DevEventsController],
})
export class DevModule implements OnModuleInit {
  constructor(@InjectPinoLogger(DevModule.name) private readonly logger: PinoLogger) {}

  onModuleInit(): void {
    this.logger.warn('development endpoints are enabled under /api/v1/dev');
  }
}
