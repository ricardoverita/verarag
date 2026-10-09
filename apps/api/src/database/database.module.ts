import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

import { CONFIG, type Config } from '../config/config.js';
import { DatabaseHealth } from './database.health.js';

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      inject: [CONFIG],
      useFactory: (config: Config) => {
        const pool = new Pool({
          connectionString: config.database.url,
          max: config.database.poolMax,
          connectionTimeoutMillis: 3_000,
          idleTimeoutMillis: 30_000,
          application_name: 'verarag-api',
        });
        // Without a listener, an error on an idle connection would crash the process.
        const logger = new Logger('Database');
        pool.on('error', (error) =>
          logger.warn(`idle database connection failed: ${error.message}`),
        );
        return pool;
      },
    },
    DatabaseHealth,
  ],
  exports: [Pool, DatabaseHealth],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
