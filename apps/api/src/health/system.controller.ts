import { Controller, Get } from '@nestjs/common';
import type { SystemStatus } from '@verarag/contracts';

import { SystemStatusService } from './system-status.service.js';

@Controller('system')
export class SystemController {
  constructor(private readonly systemStatus: SystemStatusService) {}

  /**
   * Status of the platform components. Public for now because there is no
   * authentication yet; it will require a session once phase 1 lands.
   */
  @Get('status')
  status(): Promise<SystemStatus> {
    return this.systemStatus.getStatus();
  }
}
