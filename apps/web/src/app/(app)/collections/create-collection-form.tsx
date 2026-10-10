'use client';

import type { CollectionView } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useActionState } from 'react';

import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { formText } from '@/lib/forms';

interface State {
  error?: ApiError;
  values?: { name: string; description: string };
}

export function CreateCollectionForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const values = { name: formText(form, 'name'), description: formText(form, 'description') };
      const result = await callApi<CollectionView>(
        `/api/v1/organizations/${organizationId}/collections`,
        { method: 'POST', body: { name: values.name, description: values.description || null } },
      );
      if (!result.ok) return { error: result.error, values };
      router.push(`/collections/${result.data.id}`);
      return {};
    },
    {},
  );
  const errors = fieldErrors(state.error);

  return (
    <form action={formAction} className={ui.form} noValidate>
      {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
        <p className={ui.alert} role="alert">
          {state.error.message}
        </p>
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        defaultValue={state.values?.name}
        error={errors.name}
      />
      <TextField
        label="Description"
        name="description"
        autoComplete="off"
        required={false}
        hint="Optional. What goes in this collection."
        defaultValue={state.values?.description}
        error={errors.description}
      />
      <div>
        <button className={ui.button} type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create collection'}
        </button>
      </div>
    </form>
  );
}
