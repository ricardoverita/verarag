/**
 * Operational endpoints used by Docker, Kubernetes and Prometheus. They live
 * outside the versioned `/api/v1` prefix and are not logged on every request.
 */
export const OPERATIONAL_ROUTES = ['health/live', 'health/ready', 'metrics'] as const;

export function isOperationalPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0] ?? '';
  return OPERATIONAL_ROUTES.some((route) => path === `/${route}`);
}
