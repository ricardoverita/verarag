export const HOME_PATH = '/dashboard';

/**
 * Where to go after signing in. Only paths inside this app: anything that
 * could point to another site (`//evil.example`, `/\evil.example`, a full
 * URL) falls back to the dashboard, so the sign-in page is not an open
 * redirect.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return HOME_PATH;
  }
  return value;
}
