/**
 * Error codes returned by the HTTP API. The web app branches on the code,
 * never on the message, which is meant for people and may change.
 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'EMAIL_UNAVAILABLE'
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
