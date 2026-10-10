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
  AUTHENTICATION_REQUIRED: 'Sign in to continue.',
  INVALID_SESSION: 'Your session is no longer valid. Sign in again.',
  SESSION_EXPIRED: 'Your session has expired. Sign in again.',
  INVALID_CREDENTIALS: 'The email or password is not correct.',
  TOO_MANY_ATTEMPTS: 'Too many failed sign-in attempts. Try again in a few minutes.',
  FORBIDDEN_ORIGIN: 'This request was sent from a site that is not allowed.',
  ORGANIZATION_NOT_FOUND: 'The organization does not exist or you are not a member.',
  INSUFFICIENT_ROLE: 'Your role in this organization does not allow this action.',
  MEMBER_NOT_FOUND: 'The member does not exist in this organization.',
  LAST_OWNER: 'An organization needs at least one owner. Make someone else an owner first.',
  ALREADY_A_MEMBER: 'This person is already a member of the organization.',
  INVITATION_NOT_FOUND: 'This invitation does not exist.',
  INVITATION_EXPIRED: 'This invitation has expired. Ask for a new one.',
  INVITATION_ALREADY_USED: 'This invitation has already been used.',
  INVITATION_REVOKED: 'This invitation was cancelled. Ask for a new one.',
  INVITATION_EMAIL_MISMATCH:
    'This invitation was sent to a different email. Sign in with that email to accept it.',
  API_KEY_NOT_FOUND: 'The API key does not exist in this organization.',
  INVALID_API_KEY: 'The API key is not valid.',
  API_KEY_REVOKED: 'This API key was revoked.',
  API_KEY_EXPIRED: 'This API key has expired.',
  INSUFFICIENT_SCOPE: 'This API key is not allowed to call this endpoint.',
  NOT_FOUND: 'The requested resource does not exist.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
};

/** Every error code, for the OpenAPI document. */
export const API_ERROR_CODES = Object.keys(DEFAULT_MESSAGES) as [ApiErrorCode, ...ApiErrorCode[]];
