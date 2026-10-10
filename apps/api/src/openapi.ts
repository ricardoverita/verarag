import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { API_KEY_SECURITY, SESSION_SECURITY } from './auth/auth.decorators.js';
import { apiErrorResponse } from './common/api-error.schema.js';
import type { Config } from './config/config.js';
import { APP_VERSION } from './version.js';

export const OPENAPI_PATH = 'api/docs';

/**
 * Serves the interactive documentation at /api/docs and the document at
 * /api/docs/openapi.json. Request and response schemas come from the same
 * Zod schemas that validate and serialize them. Off by default in production.
 */
export function setupOpenApi(app: NestExpressApplication, config: Config): void {
  if (!config.openApi.enabled) return;

  const options = new DocumentBuilder()
    .setTitle('VeraRAG API')
    .setDescription(
      'Control plane of VeraRAG. Browsers authenticate with the session cookie set by ' +
        '/api/v1/auth/login; programs use organization API keys on the endpoints that ' +
        'accept them. Errors always have the shape of the default response.',
    )
    .setVersion(APP_VERSION)
    .addCookieAuth(
      config.sessions.cookieName,
      { type: 'apiKey', in: 'cookie', description: 'HttpOnly session cookie.' },
      SESSION_SECURITY,
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'Organization API key (vrg_…).' },
      API_KEY_SECURITY,
    )
    .addSecurityRequirements(SESSION_SECURITY)
    .addGlobalResponse({
      status: 'default',
      description: 'Error',
      standardSchema: apiErrorResponse,
    })
    .build();

  const build = () =>
    withUploadLimit(SwaggerModule.createDocument(app, options), config.documents.maxSizeBytes);
  SwaggerModule.setup(OPENAPI_PATH, app, build, {
    jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`,
    raw: ['json'],
  });
}

/**
 * Writes the configured maximum size into every multipart upload, so the
 * document states the limit that is actually enforced.
 */
function withUploadLimit(document: OpenAPIObject, maxSizeBytes: number): OpenAPIObject {
  for (const item of Object.values(document.paths)) {
    for (const operation of [item.post, item.put]) {
      if (operation?.requestBody && 'content' in operation.requestBody) {
        if ('multipart/form-data' in operation.requestBody.content) {
          const limit = `Files can be at most ${maxSizeBytes} bytes (DOCUMENT_MAX_SIZE_BYTES).`;
          operation.description = [operation.description, limit].filter(Boolean).join(' ');
        }
      }
    }
  }
  return document;
}
