import { randomUUID } from 'node:crypto';

import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EventTypes, type SystemTestEvent } from '@verarag/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { Public } from '../auth/auth.decorators.js';
import { AppError } from '../common/app-error.js';
import {
  EventPublisher,
  type PublishedEvent,
  PublishFailedError,
} from '../messaging/event-publisher.js';

const devEventRequest = z.object({
  type: z.literal(EventTypes.SystemTest),
  message: z.string().trim().min(1).max(500),
});

type DevEventRequest = z.infer<typeof devEventRequest>;

/**
 * Development endpoint used to check the API -> NATS -> worker path.
 * It is not part of the product and is only mounted when
 * DEV_ENDPOINTS_ENABLED=true.
 */
// Never mounted in production; see DEV_ENDPOINTS_ENABLED.
@Public()
@Controller('dev/events')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class DevEventsController {
  constructor(private readonly publisher: EventPublisher) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async publish(
    @Body({ schema: devEventRequest }) body: DevEventRequest,
    @Req() req: Request,
  ): Promise<PublishedEvent> {
    const event: SystemTestEvent = {
      id: randomUUID(),
      type: body.type,
      version: 1,
      source: 'api',
      occurredAt: new Date().toISOString(),
      // The request id set by the logger, so the API and worker logs can be joined.
      ...(typeof req.id === 'string' ? { correlationId: req.id } : {}),
      data: { message: body.message },
    };

    try {
      return await this.publisher.publish(event);
    } catch (error) {
      if (error instanceof PublishFailedError) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Messaging is unavailable. Try again later.');
      }
      throw error;
    }
  }
}
