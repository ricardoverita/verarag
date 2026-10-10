import { SerializeOptions } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Declares the shape of a handler's response. The global serializer parses
 * every response with it and drops any field the schema does not list, so a
 * column added to a query (a password hash, a token hash) cannot leak by
 * accident.
 */
export function ResponseSchema(schema: z.ZodType): MethodDecorator {
  return SerializeOptions({ schema });
}
