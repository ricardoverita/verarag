import type { OrganizationDetail } from '@verarag/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { CreateOrganizationForm } from '@/components/create-organization-form';
import ui from '@/components/ui.module.css';
import { ROLE_LABELS } from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import { SystemStatusPanel, SystemStatusPlaceholder } from '../../system-status-panel';
import styles from '../app.module.css';

export const metadata: Metadata = { title: 'Dashboard' };

/** What the next phases add. Shown as upcoming, never with made-up numbers. */
const UPCOMING = [
  { label: 'Documents', note: 'Uploads and ingestion arrive in phase 2.' },
  { label: 'Collections', note: 'Grouping documents arrives in phase 2.' },
  { label: 'Queries', note: 'Search and answers arrive in later phases.' },
];

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardPlaceholder />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const session = await requireSession();
  const current = await currentMembership(session);

  if (!current) {
    return (
      <>
        <div>
          <h1 className={styles.pageTitle}>Welcome, {session.user.displayName}</h1>
          <p className={styles.pageSubtitle}>
            You do not belong to any organization right now. Create one, or ask someone to invite
            you.
          </p>
        </div>
        <section className={ui.card}>
          <h2>Create an organization</h2>
          <CreateOrganizationForm />
        </section>
      </>
    );
  }

  const detail = await serverGet<OrganizationDetail>(
    `/api/v1/organizations/${current.organization.id}`,
  );
  if (!detail.ok) {
    return (
      <p className={ui.alert} role="alert">
        {detail.error.message}
      </p>
    );
  }
  const { organization, role, memberCount } = detail.data;

  return (
    <>
      <div>
        <h1 className={styles.pageTitle}>{organization.name}</h1>
        <p className={styles.pageSubtitle}>
          You are {ROLE_LABELS[role].toLowerCase()} here · {memberCount}{' '}
          {memberCount === 1 ? 'member' : 'members'}
        </p>
      </div>

      <div className={styles.grid}>
        <Link href="/settings/members" className={`${ui.card} ${styles.stat}`}>
          <span className={styles.statLabel}>Members</span>
          <span className={styles.statValue}>{memberCount}</span>
          <span className={styles.statNote}>See who has access</span>
        </Link>
        {UPCOMING.map((item) => (
          <div key={item.label} className={`${ui.card} ${styles.stat}`}>
            <span className={styles.statLabel}>{item.label}</span>
            <span className={styles.statValue} aria-label="Not available yet">
              —
            </span>
            <span className={styles.statNote}>{item.note}</span>
          </div>
        ))}
      </div>

      <section className={ui.card} aria-labelledby="status-title">
        <h2 id="status-title">System status</h2>
        <Suspense fallback={<SystemStatusPlaceholder />}>
          <SystemStatusPanel />
        </Suspense>
      </section>
    </>
  );
}

function DashboardPlaceholder() {
  return (
    <div aria-busy="true">
      <div className={ui.skeleton} style={{ width: 240, height: 34, marginBottom: 20 }} />
      <div className={styles.grid}>
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className={ui.skeleton} style={{ height: 104 }} />
        ))}
      </div>
    </div>
  );
}
