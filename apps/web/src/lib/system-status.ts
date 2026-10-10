import type { ComponentName, ComponentStatus, SystemStatus } from '@verarag/contracts';

export type StatusResult =
  | { kind: 'ok'; status: SystemStatus }
  /** The API answered, but the details need a signed-in user. */
  | { kind: 'restricted' }
  | { kind: 'unreachable'; reason: string };

export type HealthState = 'healthy' | 'unavailable' | 'unknown';

export interface ComponentView {
  key: 'api' | ComponentName;
  label: string;
  state: HealthState;
  detail: string;
}

const LABELS: Record<ComponentName, string> = {
  database: 'Database',
  messaging: 'Messaging',
  worker: 'Worker',
  storage: 'Object storage',
};

const ORDER: ComponentName[] = ['database', 'messaging', 'worker', 'storage'];

/**
 * Asks the API for the status of the platform. Runs on the server, so the
 * API does not need to be reachable from the browser.
 */
export async function fetchSystemStatus(
  apiUrl: string,
  { fetchFn = fetch, timeoutMs = 3_000 }: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<StatusResult> {
  try {
    const response = await fetchFn(new URL('/api/v1/system/status', apiUrl), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401) {
      return { kind: 'restricted' };
    }
    if (!response.ok) {
      return { kind: 'unreachable', reason: `the API answered with HTTP ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!isSystemStatus(body)) {
      return { kind: 'unreachable', reason: 'the API sent an unexpected response' };
    }
    return { kind: 'ok', status: body };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      kind: 'unreachable',
      reason: timedOut ? `no answer after ${timeoutMs} ms` : 'the API is not reachable',
    };
  }
}

/** Turns the API response into the rows shown on the page, in a fixed order. */
export function toComponentViews(result: StatusResult): ComponentView[] {
  const api: ComponentView =
    result.kind === 'unreachable'
      ? { key: 'api', label: 'API', state: 'unavailable', detail: result.reason }
      : {
          key: 'api',
          label: 'API',
          state: 'healthy',
          detail: result.kind === 'ok' ? `version ${result.status.version}` : 'answering',
        };

  const components = ORDER.map((name): ComponentView => {
    if (result.kind === 'unreachable') {
      return {
        key: name,
        label: LABELS[name],
        state: 'unknown',
        detail: 'unknown while the API is down',
      };
    }
    if (result.kind === 'restricted') {
      return { key: name, label: LABELS[name], state: 'unknown', detail: 'sign in to see details' };
    }
    const component = result.status.components.find((item) => item.name === name);
    if (!component) {
      return {
        key: name,
        label: LABELS[name],
        state: 'unknown',
        detail: 'not reported by the API',
      };
    }
    return {
      key: name,
      label: LABELS[name],
      state: component.status === 'up' ? 'healthy' : 'unavailable',
      detail: component.status === 'up' ? describe(component) : (component.error ?? 'unavailable'),
    };
  });

  return [api, ...components];
}

function describe(component: ComponentStatus): string {
  const details = component.details ?? {};
  switch (component.name) {
    case 'database':
      return `PostgreSQL · pgvector ${String(details.pgvector ?? '?')}`;
    case 'messaging':
      return `NATS ${String(details.server ?? '?')} · JetStream`;
    case 'worker': {
      const instances = Number(details.instances ?? 0);
      return `${instances} ${instances === 1 ? 'instance' : 'instances'} · version ${String(details.version ?? '?')}`;
    }
    case 'storage':
      return `S3 bucket ${String(details.bucket ?? '?')}`;
  }
}

function isSystemStatus(value: unknown): value is SystemStatus {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SystemStatus>;
  return typeof candidate.version === 'string' && Array.isArray(candidate.components);
}
