import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/auth.decorators.js';
import { MetricsService } from './metrics.service.js';

// Prometheus text format, not part of the HTTP API.
@ApiExcludeController()
@SkipThrottle()
@Public()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
