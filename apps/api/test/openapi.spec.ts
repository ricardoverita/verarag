import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from './support/test-app.js';

interface Operation {
  security?: Record<string, string[]>[];
  responses: Record<string, { content?: { 'application/json': { schema: Schema } } }>;
  requestBody?: { content: { 'application/json': { schema: Schema } } };
}

interface Schema {
  properties?: Record<string, Schema>;
  required?: string[];
  minLength?: number;
}

interface Document {
  openapi: string;
  info: { title: string };
  security: Record<string, string[]>[];
  components: { securitySchemes: Record<string, { type: string; in?: string; name?: string }> };
  paths: Record<string, Record<string, Operation>>;
}

describe('OpenAPI', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function fetchDocument(): Promise<Document> {
    app = await createTestApp();
    const response = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    return response.body as Document;
  }

  it('documents the API with the session cookie as the default credential', async () => {
    const document = await fetchDocument();

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('VeraRAG API');
    expect(document.security).toEqual([{ session: [] }]);
    expect(document.components.securitySchemes).toMatchObject({
      session: { type: 'apiKey', in: 'cookie', name: 'verarag_session' },
      apiKey: { type: 'http' },
    });
    expect(document.paths['/metrics']).toBeUndefined();
  });

  it('marks public routes and the routes that accept API keys', async () => {
    const { paths } = await fetchDocument();

    expect(paths['/api/v1/auth/login']?.post?.security).toEqual([{}]);
    expect(paths['/api/v1/invitations/preview']?.post?.security).toEqual([{}]);
    expect(paths['/api/v1/organizations']?.get?.security).toBeUndefined();
    expect(paths['/api/v1/system/status']?.get?.security).toEqual([
      { session: [] },
      { apiKey: [] },
    ]);
  });

  it('takes request and response shapes from the validation schemas', async () => {
    const { paths } = await fetchDocument();
    const register = paths['/api/v1/auth/register']!.post!;

    const body = register.requestBody!.content['application/json'].schema;
    expect(body.required).toEqual(['email', 'password', 'displayName', 'organizationName']);
    expect(body.properties?.password?.minLength).toBe(12);

    const created = register.responses['201']!.content!['application/json'].schema;
    expect(Object.keys(created.properties?.user?.properties ?? {})).toEqual([
      'id',
      'email',
      'displayName',
      'createdAt',
    ]);
    const error = register.responses.default!.content!['application/json'].schema;
    expect(error.properties?.error?.required).toEqual(['code', 'message']);
  });

  it('documents the multipart upload with the configured size limit and the supported types', async () => {
    const { paths } = await fetchDocument();
    const upload = paths[
      '/api/v1/organizations/{organizationId}/collections/{collectionId}/documents'
    ]!.post as Operation & {
      description?: string;
      requestBody: {
        content: Record<
          string,
          {
            schema: Schema & {
              properties: Record<string, { format?: string; description?: string }>;
            };
          }
        >;
      };
    };

    const form = upload.requestBody.content['multipart/form-data']!.schema;
    expect(form.properties.file?.format).toBe('binary');
    expect(form.properties.file?.description).toContain('application/pdf (.pdf)');
    expect(upload.description).toContain(`${25 * 1024 * 1024} bytes`);
  });

  it('contains no secrets or examples that look like them', async () => {
    const document = JSON.stringify(await fetchDocument());

    expect(document).not.toMatch(/vrg_[0-9a-f]{12}_/);
    expect(document).not.toMatch(/argon2|password_hash|token_hash|key_hash/i);
    expect(document).not.toContain('"example');
  });

  it('serves the interactive documentation', async () => {
    app = await createTestApp();

    const response = await request(app.getHttpServer()).get('/api/docs/').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('is not served when disabled', async () => {
    app = await createTestApp({ config: { openApi: { enabled: false } } });

    await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(404);
    await request(app.getHttpServer()).get('/api/docs/').expect(404);
  });
});
