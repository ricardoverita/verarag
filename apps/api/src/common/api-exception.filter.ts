import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiErrorCode, ApiErrorResponse } from '@verarag/contracts';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppError } from './app-error.js';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  EMAIL_UNAVAILABLE: HttpStatus.CONFLICT,
  AUTHENTICATION_REQUIRED: HttpStatus.UNAUTHORIZED,
  INVALID_SESSION: HttpStatus.UNAUTHORIZED,
  SESSION_EXPIRED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
  FORBIDDEN_ORIGIN: HttpStatus.FORBIDDEN,
  ORGANIZATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSUFFICIENT_ROLE: HttpStatus.FORBIDDEN,
  MEMBER_NOT_FOUND: HttpStatus.NOT_FOUND,
  LAST_OWNER: HttpStatus.CONFLICT,
  ALREADY_A_MEMBER: HttpStatus.CONFLICT,
  INVITATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  // Gone: the link existed but can no longer be used.
  INVITATION_EXPIRED: HttpStatus.GONE,
  INVITATION_ALREADY_USED: HttpStatus.GONE,
  INVITATION_REVOKED: HttpStatus.GONE,
  INVITATION_EMAIL_MISMATCH: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Turns every error into `{ "error": { code, message, requestId } }`.
 * Unexpected errors are logged with their stack and answered with a generic
 * message: stack traces and driver messages never reach the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(ApiExceptionFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const error = this.toAppError(exception);
    const status = STATUS_BY_CODE[error.code];
    if (status >= 500 && !(exception instanceof AppError)) {
      this.logger.error({ err: exception }, 'request failed');
    }

    const body: ApiErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        ...(typeof req.id === 'string' ? { requestId: req.id } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    };
    res.status(status).json(body);
  }

  private toAppError(exception: unknown): AppError {
    if (exception instanceof AppError) {
      return exception;
    }
    if (exception instanceof ThrottlerException) {
      return new AppError('RATE_LIMITED');
    }
    const status = statusOf(exception);
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        // Body parser errors, such as malformed JSON.
        return new AppError('VALIDATION_FAILED', 'The request body is not valid JSON.');
      case HttpStatus.NOT_FOUND:
        return new AppError('NOT_FOUND');
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return new AppError('PAYLOAD_TOO_LARGE');
      case HttpStatus.SERVICE_UNAVAILABLE:
        return new AppError('SERVICE_UNAVAILABLE');
      default:
        return new AppError('INTERNAL_ERROR');
    }
  }
}

/** Status of Nest HTTP exceptions and of errors thrown by Express middleware. */
function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (typeof exception === 'object' && exception !== null && 'status' in exception) {
    return typeof exception.status === 'number' ? exception.status : undefined;
  }
  return undefined;
}
