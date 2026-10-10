import {
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';

import { AppError } from './app-error.js';

/**
 * Validates parameters declared with a schema, e.g. `@Body({ schema })`, and
 * reports every invalid field as `VALIDATION_FAILED` with its path. Input
 * values are never echoed back, so a rejected password does not end up in a
 * response or a log.
 */
export function validationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues: readonly Issue[]) =>
      new AppError(
        'VALIDATION_FAILED',
        undefined,
        issues.map((issue) => ({ path: pathOf(issue), message: issue.message })),
      ),
  });
}

type Issue = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0][number];

function pathOf(issue: Issue): string {
  return (issue.path ?? [])
    .map((segment) => (typeof segment === 'object' ? segment.key : segment))
    .map(String)
    .join('.');
}
