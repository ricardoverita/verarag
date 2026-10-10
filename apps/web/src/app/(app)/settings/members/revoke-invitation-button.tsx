'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { callApi } from '@/lib/client-api';

export function RevokeInvitationButton({
  organizationId,
  invitationId,
  email,
}: {
  organizationId: string;
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className={`${ui.button} ${ui.secondary} ${ui.small}`}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Cancel the invitation for ${email}? The link stops working.`)) {
            return;
          }
          startTransition(async () => {
            const result = await callApi(
              `/api/v1/organizations/${organizationId}/invitations/${invitationId}`,
              { method: 'DELETE' },
            );
            if (!result.ok) {
              setFailed(result.error.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
      {failed ? (
        <span className={ui.fieldError} role="alert">
          {failed}
        </span>
      ) : null}
    </>
  );
}
