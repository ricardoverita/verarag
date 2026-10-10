'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { callApi } from '@/lib/client-api';

export function RevokeApiKeyButton({
  organizationId,
  apiKeyId,
  name,
}: {
  organizationId: string;
  apiKeyId: string;
  name: string;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className={`${ui.button} ${ui.danger} ${ui.small}`}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Revoke “${name}”? Programs using it stop working right away.`)) {
            return;
          }
          startTransition(async () => {
            const result = await callApi(
              `/api/v1/organizations/${organizationId}/api-keys/${apiKeyId}`,
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
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {failed ? (
        <span className={ui.fieldError} role="alert">
          {failed}
        </span>
      ) : null}
    </>
  );
}
