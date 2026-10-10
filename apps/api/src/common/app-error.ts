import type { ApiErrorCode, ApiErrorDetail } from '@verarag/contracts';

/**
 * An expected error with a stable code. Domain and application code throw it
 * without knowing about HTTP; the exception filter turns the code into a
 * status and a response body.
 */
export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly code: ApiErrorCode,
    message?: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
  }
}

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: 'The request is not valid.',
  EMAIL_UNAVAILABLE: 'This email cannot be used to create an account.',
  NOT_FOUND: 'The requested resource does not exist.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
};
