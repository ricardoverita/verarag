'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { type ApiError, callApi } from '@/lib/client-api';

export function LeaveOrganization({
  organizationId,
  membershipId,
  organizationName,
}: {
  organizationId: string;
  membershipId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError>();
  const [pending, startTransition] = useTransition();

  return (
    <div className={ui.form}>
      {error ? (
        <p className={ui.alert} role="alert">
          {error.message}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className={`${ui.button} ${ui.danger}`}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Leave ${organizationName}?`)) return;
            startTransition(async () => {
              const result = await callApi(
                `/api/v1/organizations/${organizationId}/members/${membershipId}`,
                { method: 'DELETE' },
              );
              if (!result.ok) {
                setError(result.error);
                return;
              }
              // The dashboard falls back to another organization, if any.
              router.push('/dashboard');
              router.refresh();
            });
          }}
        >
          {pending ? 'Leaving…' : `Leave ${organizationName}`}
        </button>
      </div>
    </div>
  );
}
