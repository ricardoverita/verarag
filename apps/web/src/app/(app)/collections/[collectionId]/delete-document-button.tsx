'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { callApi } from '@/lib/client-api';

/** Deletes the document and its stored file. A storage failure leaves it to retry. */
export function DeleteDocumentButton({
  organizationId,
  documentId,
  filename,
  redirectTo,
}: {
  organizationId: string;
  documentId: string;
  filename: string;
  redirectTo?: string;
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
          if (!window.confirm(`Delete “${filename}”? Its file is removed from storage.`)) return;
          startTransition(async () => {
            const result = await callApi(
              `/api/v1/organizations/${organizationId}/documents/${documentId}`,
              { method: 'DELETE' },
            );
            if (!result.ok) {
              setFailed(result.error.message);
              router.refresh();
              return;
            }
            if (redirectTo) router.push(redirectTo);
            router.refresh();
          });
        }}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      {failed ? (
        <span className={ui.fieldError} role="alert">
          {failed}
        </span>
      ) : null}
    </>
  );
}
