'use client';

import type { CollectionView } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';

import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { formText } from '@/lib/forms';

import list from '../collections.module.css';

interface State {
  error?: ApiError;
  values?: { name: string; description: string };
}

/** Rename, describe or delete the collection. Only shown to owners and admins. */
export function EditCollection({
  organizationId,
  collection,
}: {
  organizationId: string;
  collection: CollectionView;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiError>();
  const [deleting, startDelete] = useTransition();
  const path = `/api/v1/organizations/${organizationId}/collections/${collection.id}`;

  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const values = { name: formText(form, 'name'), description: formText(form, 'description') };
      const result = await callApi<CollectionView>(path, {
        method: 'PATCH',
        body: { name: values.name, description: values.description || null },
      });
      if (!result.ok) return { error: result.error, values };
      setEditing(false);
      router.refresh();
      return {};
    },
    {},
  );
  const errors = fieldErrors(state.error);

  if (!editing) {
    return (
      <div className={list.rowActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.secondary} ${ui.small}`}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.danger} ${ui.small}`}
          disabled={deleting}
          title={
            collection.documentCount > 0 ? 'Delete its documents first' : 'Delete the collection'
          }
          onClick={() => {
            if (!window.confirm(`Delete the collection “${collection.name}”?`)) return;
            startDelete(async () => {
              const result = await callApi(path, { method: 'DELETE' });
              if (!result.ok) {
                setDeleteError(result.error);
                return;
              }
              router.push('/collections');
              router.refresh();
            });
          }}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        {deleteError ? (
          <p className={ui.fieldError} role="alert">
            {deleteError.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className={`${ui.form} ${ui.card}`} noValidate>
      {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
        <p className={ui.alert} role="alert">
          {state.error.message}
        </p>
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        defaultValue={state.values?.name ?? collection.name}
        error={errors.name}
      />
      <TextField
        label="Description"
        name="description"
        autoComplete="off"
        required={false}
        defaultValue={state.values?.description ?? collection.description ?? ''}
        error={errors.description}
      />
      <div className={list.rowActions} style={{ justifyContent: 'flex-start' }}>
        <button className={ui.button} type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          className={`${ui.button} ${ui.secondary}`}
          type="button"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
