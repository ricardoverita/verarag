/**
 * JetStream streams. The API creates them and owns their configuration; the
 * worker only binds its consumers to them.
 */
export const Streams = {
  System: {
    name: 'SYSTEM',
    subjects: ['system.>'],
  },
} as const;

/** Key-value bucket where every worker instance writes its heartbeat. */
export const WORKER_HEARTBEAT_BUCKET = 'worker-heartbeats';
