import type { ApiKeyScope } from '@verarag/contracts';

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

/** A program calling with an organization API key. There is no user behind it. */
export interface ApiKeyPrincipal {
  kind: 'apiKey';
  apiKeyId: string;
  organizationId: string;
  scopes: ApiKeyScope[];
}

/** Who is making the request, set by the global AuthGuard. */
export type Principal = SessionPrincipal | ApiKeyPrincipal;

// Express merges this global namespace into its Request type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
