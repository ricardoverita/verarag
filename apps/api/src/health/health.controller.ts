import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/auth.decorators.js';
import type { Response } from 'express';

import { type Readiness, SystemStatusService } from './system-status.service.js';

// Probes run every few seconds from Docker or Kubernetes.
@SkipThrottle()
@Public()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly systemStatus: SystemStatusService) {}

  /** Liveness: the process is up and serving HTTP. It never checks dependencies. */
  @Get('health/live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the API can reach the dependencies it needs to serve requests. */
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<Readiness> {
    const readiness = await this.systemStatus.readiness();
    if (readiness.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
