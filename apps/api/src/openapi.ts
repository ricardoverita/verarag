import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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

  SwaggerModule.setup(OPENAPI_PATH, app, () => SwaggerModule.createDocument(app, options), {
    jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`,
    raw: ['json'],
  });
}
