import type { Request } from 'express';

/** The request id assigned by the logger, if any. */
export function requestIdOf(req: Request): string | undefined {
  return typeof req.id === 'string' ? req.id : undefined;
}
