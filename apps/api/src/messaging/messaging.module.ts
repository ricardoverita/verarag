import { Module } from '@nestjs/common';
import { ContractValidator } from '@verarag/contracts/validation';

import { EventPublisher } from './event-publisher.js';
import { NatsClient } from './nats.client.js';
import { WorkerHeartbeats } from './worker-heartbeats.js';

@Module({
  providers: [
    NatsClient,
    EventPublisher,
    WorkerHeartbeats,
    // Compiles the shared JSON Schemas once.
    { provide: ContractValidator, useFactory: () => new ContractValidator() },
  ],
  exports: [NatsClient, EventPublisher, WorkerHeartbeats],
})
export class MessagingModule {}
