import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';
import { loggerOptions } from './logger.options.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { TracingService } from './tracing.service.js';

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => loggerOptions(config),
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService, TracingService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
