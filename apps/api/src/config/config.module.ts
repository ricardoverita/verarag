import { type DynamicModule, Module } from '@nestjs/common';

import { CONFIG, type Config } from './config.js';

/**
 * The configuration is loaded and validated in main.ts, before Nest starts,
 * and then provided here so tests can pass their own values.
 */
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
