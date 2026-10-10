/**
 * Error codes returned by the HTTP API. The web app branches on the code,
 * never on the message, which is meant for people and may change.
 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'EMAIL_UNAVAILABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_SESSION'
  | 'SESSION_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'FORBIDDEN_ORIGIN'
  | 'ORGANIZATION_NOT_FOUND'
  | 'INSUFFICIENT_ROLE'
  | 'MEMBER_NOT_FOUND'
  | 'LAST_OWNER'
  | 'ALREADY_A_MEMBER'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_USED'
  | 'INVITATION_REVOKED'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'API_KEY_NOT_FOUND'
  | 'INVALID_API_KEY'
  | 'API_KEY_REVOKED'
  | 'API_KEY_EXPIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'COLLECTION_NOT_FOUND'
  | 'COLLECTION_NAME_TAKEN'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ApiErrorDetail {
  /** Dotted path of the invalid field, for example `email` or `members.0.role`. */
  path: string;
  message: string;
}

/** Body of every error response. */
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
    details?: ApiErrorDetail[];
  };
}
