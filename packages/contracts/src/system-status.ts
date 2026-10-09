/**
 * Response of `GET /api/v1/system/status`. It is only exchanged between the
 * TypeScript apps (API and web), so it does not have a JSON Schema yet.
 */
export type ComponentName = 'database' | 'storage';

export interface ComponentStatus {
  name: ComponentName;
  status: 'up' | 'down';
  latencyMs: number;
  details?: Record<string, string | number | boolean>;
  /** Short reason, only present when the component is down. */
  error?: string;
}

export interface SystemStatus {
  status: 'ok' | 'degraded';
  version: string;
  checkedAt: string;
  components: ComponentStatus[];
}
