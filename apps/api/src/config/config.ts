import { z } from 'zod';

/** Treats empty variables (`FOO=`) as unset, which is what `.env` files usually mean. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  S3_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3).max(63),
  S3_ACCESS_KEY_ID: optional(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: optional(z.string().min(1)),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  /** One URL or a comma-separated list of NATS servers. */
  NATS_URL: z.string().min(1).default('nats://localhost:4222'),

  DEV_ENDPOINTS_ENABLED: z.stringbool().default(false),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export interface Config {
  logLevel: LogLevel;
  http: { host: string; port: number };
  database: { url: string; poolMax: number };
  storage: {
    endpoint?: string;
    region: string;
    bucket: string;
    /** When unset the AWS SDK falls back to its default credential chain. */
    credentials?: { accessKeyId: string; secretAccessKey: string };
    forcePathStyle: boolean;
  };
  nats: { servers: string[] };
  /** Enables /api/v1/dev/*. Meant for local development and integration tests only. */
  devEndpointsEnabled: boolean;
}

/** Injection token for the validated configuration. */
export const CONFIG = Symbol('CONFIG');

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const vars = result.data;

  if (Boolean(vars.S3_ACCESS_KEY_ID) !== Boolean(vars.S3_SECRET_ACCESS_KEY)) {
    throw new ConfigError(['S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together']);
  }

  return {
    logLevel: vars.LOG_LEVEL,
    http: { host: vars.API_HOST, port: vars.API_PORT },
    database: { url: vars.DATABASE_URL, poolMax: vars.DATABASE_POOL_MAX },
    storage: {
      endpoint: vars.S3_ENDPOINT,
      region: vars.S3_REGION,
      bucket: vars.S3_BUCKET,
      credentials:
        vars.S3_ACCESS_KEY_ID && vars.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: vars.S3_ACCESS_KEY_ID, secretAccessKey: vars.S3_SECRET_ACCESS_KEY }
          : undefined,
      forcePathStyle: vars.S3_FORCE_PATH_STYLE,
    },
    nats: { servers: vars.NATS_URL.split(',').map((server) => server.trim()) },
    devEndpointsEnabled: vars.DEV_ENDPOINTS_ENABLED,
  };
}
