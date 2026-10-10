import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuditModule } from './audit/audit.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import type { Config } from './config/config.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DevModule } from './dev/dev.module.js';
import { HealthModule } from './health/health.module.js';
import { ObservabilityModule } from './observability/observability.module.js';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        ObservabilityModule,
        // In-memory limits are enough for a single instance. They move to
        // Redis when the API runs with several replicas.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
        DatabaseModule,
        AuditModule,
        AuthModule,
        HealthModule,
        ...(config.devEndpointsEnabled ? [DevModule] : []),
      ],
      providers: [
        // Order matters: rate limits apply before any session lookup.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
