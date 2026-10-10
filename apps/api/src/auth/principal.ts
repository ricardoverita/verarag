/** The person behind a browser session. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface SessionPrincipal {
  kind: 'session';
  user: AuthenticatedUser;
  sessionId: string;
  expiresAt: Date;
}

/** Who is making the request, set by the global AuthGuard. */
export type Principal = SessionPrincipal;

// Express merges this global namespace into its Request type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
