import { type DynamicModule, Module } from '@nestjs/common';

import type { Config } from './config/config.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { ObservabilityModule } from './observability/observability.module.js';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), ObservabilityModule, DatabaseModule, HealthModule],
    };
  }
}
