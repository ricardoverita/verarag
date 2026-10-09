import { connection } from 'next/server';

import { type ComponentView, fetchSystemStatus, toComponentViews } from '@/lib/system-status';

import styles from './page.module.css';

const STATE_LABELS: Record<ComponentView['state'], string> = {
  healthy: 'Healthy',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

export async function SystemStatusPanel() {
  // Rendered on every request, never at build time.
  await connection();

  const result = await fetchSystemStatus(process.env.API_INTERNAL_URL ?? 'http://localhost:3001');
  const views = toComponentViews(result);
  const checkedAt = result.reachable
    ? new Date(result.status.checkedAt).toISOString().slice(11, 19)
    : undefined;

  return (
    <>
      <ul className={styles.statusList}>
        {views.map((view) => (
          <StatusRow key={view.key} view={view} />
        ))}
      </ul>
      <p className={styles.statusFootnote}>
        {checkedAt ? `Checked at ${checkedAt} UTC. ` : ''}Refreshes every 10 seconds.
      </p>
    </>
  );
}

export function SystemStatusPlaceholder() {
  return (
    <ul className={styles.statusList} aria-busy="true">
      {['API', 'Database', 'Messaging', 'Worker', 'Object storage'].map((label) => (
        <StatusRow
          key={label}
          view={{ key: 'api', label, state: 'unknown', detail: 'checking…' }}
        />
      ))}
    </ul>
  );
}

function StatusRow({ view }: { view: ComponentView }) {
  return (
    <li className={styles.statusRow}>
      <span className={styles.statusName}>{view.label}</span>
      <span className={styles.statusDetail}>{view.detail}</span>
      <span className={`${styles.badge} ${styles[view.state]}`}>{STATE_LABELS[view.state]}</span>
    </li>
  );
}
