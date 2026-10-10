'use client';

import type { OrganizationDetail } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useActionState } from 'react';

import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { formText } from '@/lib/forms';

interface State {
  error?: ApiError;
  saved?: boolean;
  name?: string;
}

export function RenameOrganizationForm({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const next = formText(form, 'name');
      const result = await callApi<OrganizationDetail>(`/api/v1/organizations/${organizationId}`, {
        method: 'PATCH',
        body: { name: next },
      });
      if (!result.ok) return { error: result.error, name: next };
      router.refresh();
      return { saved: true, name: result.data.organization.name };
    },
    { name },
  );

  return (
    <form action={formAction} className={ui.form} noValidate>
      {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
        <p className={ui.alert} role="alert">
          {state.error.message}
        </p>
      ) : null}
      {state.saved ? (
        <p className={ui.success} role="status">
          Saved.
        </p>
      ) : null}
      <div className={ui.row}>
        <TextField
          label="Name"
          name="name"
          defaultValue={state.name}
          error={fieldErrors(state.error).name}
        />
        <button className={ui.button} type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
