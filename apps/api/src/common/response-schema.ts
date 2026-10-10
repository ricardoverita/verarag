import { applyDecorators, HttpCode, HttpStatus, SerializeOptions } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { z } from 'zod';

/**
 * Declares the status and the shape of a handler's response. The global
 * serializer parses every response with the schema and drops any field it
 * does not list, so a column added to a query (a password hash, a token
 * hash) cannot leak by accident. The same schema documents the response in
 * OpenAPI, so the documentation cannot drift from what is sent.
 */
export function ResponseSchema(
  schema: z.ZodType,
  status: HttpStatus = HttpStatus.OK,
): MethodDecorator {
  return applyDecorators(
    HttpCode(status),
    SerializeOptions({ schema }),
    ApiResponse({ status, standardSchema: schema }),
  );
}
