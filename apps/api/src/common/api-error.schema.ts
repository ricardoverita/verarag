import type { ApiErrorResponse } from '@verarag/contracts';
import { z } from 'zod';

import { API_ERROR_CODES } from './app-error.js';

/** The body of every error response, as documented in OpenAPI. */
export const apiErrorResponse = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
}) satisfies z.ZodType<ApiErrorResponse>;
