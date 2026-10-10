'use client';

import type { MembershipSummary } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { ROLE_LABELS } from '@/lib/organizations';

import { selectOrganization } from './actions';
import styles from './app.module.css';

const NEW_ORGANIZATION = 'new';

export function OrganizationSwitcher({
  memberships,
  currentId,
}: {
  memberships: MembershipSummary[];
  currentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      className={`${ui.select} ${styles.switcher}`}
      aria-label="Organization"
      value={currentId}
      disabled={pending}
      onChange={(event) => {
        const value = event.target.value;
        if (value === NEW_ORGANIZATION) {
          router.push('/organizations/new');
          return;
        }
        // Setting the cookie re-renders the current page for the new organization.
        startTransition(() => selectOrganization(value));
      }}
    >
      {memberships.map((membership) => (
        <option key={membership.organization.id} value={membership.organization.id}>
          {membership.organization.name} · {ROLE_LABELS[membership.role]}
        </option>
      ))}
      <option value={NEW_ORGANIZATION}>+ New organization…</option>
    </select>
  );
}
