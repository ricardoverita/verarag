/** Mirrors schemas/status/worker-heartbeat.schema.json. */
export interface WorkerHeartbeat {
  instanceId: string;
  version: string;
  startedAt: string;
  sentAt: string;
}
