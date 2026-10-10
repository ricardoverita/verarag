import { z } from 'zod';

/** Treats empty variables (`FOO=`) as unset, which is what `.env` files usually mean. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  /**
   * Anything that is not explicitly development or test is treated as
   * production, so a missing variable never relaxes a security setting.
   */
  APP_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /**
   * Express "trust proxy" setting: which proxies may set X-Forwarded-For.
   * The client IP drives rate limiting, so only trust proxies you run.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value): boolean | number | string => {
      if (value === 'true' || value === 'false') return value === 'true';
      return /^\d+$/.test(value) ? Number(value) : value;
    }),

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

  /** Public URL of the web app: allowed browser origin and base of invitation links. */
  WEB_PUBLIC_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(30 * 24)
    .default(7 * 24),
  /** Defaults to true in production, where it cannot be turned off. */
  SESSION_COOKIE_SECURE: optional(z.stringbool()),
  /** Serves /api/docs. Defaults to on outside production and off in production. */
  OPENAPI_ENABLED: optional(z.stringbool()),
  INVITATION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(30 * 24)
    .default(7 * 24),

  /** Standard OpenTelemetry variable. Tracing is off when it is not set. */
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export type AppEnv = 'development' | 'test' | 'production';

export interface Config {
  env: AppEnv;
  logLevel: LogLevel;
  http: { host: string; port: number; trustProxy: boolean | number | string };
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
  tracing: { endpoint?: string };
  web: { publicUrl: string; origin: string };
  sessions: {
    ttlHours: number;
    cookieSecure: boolean;
    /** `__Host-` binds secure cookies to the exact host and path `/`. */
    cookieName: string;
  };
  invitations: { ttlHours: number };
  /** Interactive documentation at /api/docs and the document at /api/docs/openapi.json. */
  openApi: { enabled: boolean };
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

  const problems: string[] = [];
  if (Boolean(vars.S3_ACCESS_KEY_ID) !== Boolean(vars.S3_SECRET_ACCESS_KEY)) {
    problems.push('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together');
  }
  const production = vars.APP_ENV === 'production';
  if (production && vars.DEV_ENDPOINTS_ENABLED) {
    problems.push('DEV_ENDPOINTS_ENABLED cannot be true when APP_ENV=production');
  }
  if (production && vars.SESSION_COOKIE_SECURE === false) {
    problems.push('SESSION_COOKIE_SECURE cannot be false when APP_ENV=production');
  }
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  const cookieSecure = vars.SESSION_COOKIE_SECURE ?? production;

  return {
    env: vars.APP_ENV,
    logLevel: vars.LOG_LEVEL,
    http: { host: vars.API_HOST, port: vars.API_PORT, trustProxy: vars.TRUST_PROXY },
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
    tracing: { endpoint: vars.OTEL_EXPORTER_OTLP_ENDPOINT },
    web: { publicUrl: vars.WEB_PUBLIC_URL, origin: new URL(vars.WEB_PUBLIC_URL).origin },
    sessions: {
      ttlHours: vars.SESSION_TTL_HOURS,
      cookieSecure,
      cookieName: cookieSecure ? '__Host-verarag_session' : 'verarag_session',
    },
    invitations: { ttlHours: vars.INVITATION_TTL_HOURS },
    openApi: { enabled: vars.OPENAPI_ENABLED ?? !production },
  };
}
