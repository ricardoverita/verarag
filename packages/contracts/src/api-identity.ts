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
