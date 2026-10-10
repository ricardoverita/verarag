'use client';

import type { MemberRole } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { type ApiError, callApi } from '@/lib/client-api';
import { ROLE_LABELS } from '@/lib/organizations';

import settings from '../settings.module.css';
import styles from './members.module.css';

/** Role, join date and the actions the current user may take on one member. */
export function MemberActions({
  organizationId,
  membershipId,
  name,
  role,
  joined,
  roles,
  removable,
}: {
  organizationId: string;
  membershipId: string;
  name: string;
  role: MemberRole;
  joined: string;
  roles: MemberRole[];
  removable: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError>();
  const [pending, startTransition] = useTransition();
  const path = `/api/v1/organizations/${organizationId}/members/${membershipId}`;

  const run = (request: () => ReturnType<typeof callApi>) =>
    startTransition(async () => {
      setError(undefined);
      const result = await request();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });

  return (
    <div className={styles.memberActions}>
      <div className={styles.role}>
        {roles.length > 0 ? (
          <select
            className={ui.select}
            aria-label={`Role of ${name}`}
            value={role}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value;
              run(() => callApi(path, { method: 'PATCH', body: { role: next } }));
            }}
          >
            {roles.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        ) : (
          <span>{ROLE_LABELS[role]}</span>
        )}
      </div>
      <span className={settings.secondaryText}>{joined}</span>
      <div className={settings.actions}>
        {removable ? (
          <button
            type="button"
            className={`${ui.button} ${ui.danger} ${ui.small}`}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Remove ${name} from the organization?`)) return;
              run(() => callApi(path, { method: 'DELETE' }));
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {error ? (
        <p className={`${ui.fieldError} ${styles.error}`} role="alert">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
