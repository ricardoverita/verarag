/**
 * HTTP payloads for users, organizations and memberships, shared by the API
 * and the web app. Dates are ISO 8601 strings.
 */
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

export interface RegisterResponse {
  user: UserView;
  organization: OrganizationView;
  role: MemberRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** An organization the user belongs to, with their role in it. */
export interface MembershipSummary {
  organization: OrganizationView;
  role: MemberRole;
  joinedAt: string;
}

/** `GET /api/v1/auth/me` and the response of a successful login. */
export interface MeResponse {
  user: UserView;
  memberships: MembershipSummary[];
  session: { expiresAt: string };
}
