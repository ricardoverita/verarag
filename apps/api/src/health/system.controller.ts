import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { SystemStatus } from '@verarag/contracts';

import { ApiKeyScopes } from '../auth/auth.decorators.js';
import { SystemStatusService } from './system-status.service.js';

// The web app polls this endpoint, and SystemStatusService caches the result.
@SkipThrottle()
@Controller('system')
export class SystemController {
  constructor(private readonly systemStatus: SystemStatusService) {}

  /**
   * Status of the platform components. It names versions and internal
   * resources, so it needs a session or an API key with `system:read`;
   * infrastructure probes use /health/*.
   */
  @Get('status')
  @ApiKeyScopes('system:read')
  status(): Promise<SystemStatus> {
    return this.systemStatus.getStatus();
  }
}
