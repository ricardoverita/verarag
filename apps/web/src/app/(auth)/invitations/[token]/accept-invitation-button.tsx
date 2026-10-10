'use client';

import type { MembershipSummary } from '@verarag/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { selectOrganization } from '@/app/(app)/actions';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi } from '@/lib/client-api';

export function AcceptInvitationButton({
  token,
  organizationName,
}: {
  token: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError>();
  const [pending, startTransition] = useTransition();

  return (
    <div className={ui.form}>
      {error ? (
        <p className={ui.alert} role="alert">
          {error.message}{' '}
          {error.code === 'ALREADY_A_MEMBER' ? <Link href="/dashboard">Open it</Link> : null}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className={ui.button}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await callApi<MembershipSummary>('/api/v1/invitations/accept', {
                method: 'POST',
                body: { token },
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              await selectOrganization(result.data.organization.id);
              router.push('/dashboard');
            })
          }
        >
          {pending ? 'Joining…' : `Join ${organizationName}`}
        </button>
      </div>
    </div>
  );
}
