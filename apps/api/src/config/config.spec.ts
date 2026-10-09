import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const baseEnv = {
  DATABASE_URL: 'postgres://verarag:secret@localhost:5432/verarag',
  S3_BUCKET: 'verarag-documents',
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    const config = loadConfig(baseEnv);

    expect(config.http).toEqual({ host: '0.0.0.0', port: 3001 });
    expect(config.logLevel).toBe('info');
    expect(config.database.poolMax).toBe(10);
    expect(config.nats.servers).toEqual(['nats://localhost:4222']);
    expect(config.devEndpointsEnabled).toBe(false);
    expect(config.tracing.endpoint).toBeUndefined();
    expect(config.storage).toEqual({
      endpoint: undefined,
      region: 'us-east-1',
      bucket: 'verarag-documents',
      credentials: undefined,
      forcePathStyle: false,
    });
  });

  it('reads S3-compatible storage settings', () => {
    const config = loadConfig({
      ...baseEnv,
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'access',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
    });

    expect(config.storage.endpoint).toBe('http://minio:9000');
    expect(config.storage.credentials).toEqual({
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    });
    expect(config.storage.forcePathStyle).toBe(true);
  });

  it('accepts several NATS servers', () => {
    const config = loadConfig({ ...baseEnv, NATS_URL: 'nats://nats-1:4222, nats://nats-2:4222' });

    expect(config.nats.servers).toEqual(['nats://nats-1:4222', 'nats://nats-2:4222']);
  });

  it('only enables the development endpoints explicitly', () => {
    expect(loadConfig({ ...baseEnv, DEV_ENDPOINTS_ENABLED: 'true' }).devEndpointsEnabled).toBe(
      true,
    );
    expect(() => loadConfig({ ...baseEnv, DEV_ENDPOINTS_ENABLED: 'maybe' })).toThrow(
      /DEV_ENDPOINTS_ENABLED/,
    );
  });

  it('treats empty variables as unset', () => {
    const config = loadConfig({ ...baseEnv, S3_ENDPOINT: '', S3_ACCESS_KEY_ID: '' });

    expect(config.storage.endpoint).toBeUndefined();
    expect(config.storage.credentials).toBeUndefined();
  });

  it('lists every invalid variable', () => {
    expect(() => loadConfig({ API_PORT: 'eighty', S3_BUCKET: 'verarag-documents' })).toThrow(
      ConfigError,
    );

    try {
      loadConfig({ API_PORT: 'eighty', S3_BUCKET: 'verarag-documents' });
    } catch (error) {
      const issues = (error as ConfigError).issues.join('\n');
      expect(issues).toContain('API_PORT');
      expect(issues).toContain('DATABASE_URL');
    }
  });

  it('rejects database URLs that are not PostgreSQL', () => {
    expect(() => loadConfig({ ...baseEnv, DATABASE_URL: 'mysql://localhost/verarag' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires both S3 credentials or none', () => {
    expect(() => loadConfig({ ...baseEnv, S3_ACCESS_KEY_ID: 'access' })).toThrow(
      /must be set together/,
    );
  });
});
