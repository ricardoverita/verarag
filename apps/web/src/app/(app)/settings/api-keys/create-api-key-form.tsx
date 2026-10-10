'use client';

import type { CreatedApiKeyResponse } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useActionState, useId } from 'react';

import { CopyField } from '@/components/copy-field';
import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { formText } from '@/lib/forms';

import settings from '../settings.module.css';

const EXPIRY_OPTIONS = [
  { value: '30', label: 'In 30 days' },
  { value: '90', label: 'In 90 days' },
  { value: '365', label: 'In a year' },
  { value: '', label: 'Never' },
];

interface State {
  error?: ApiError;
  name?: string;
  created?: CreatedApiKeyResponse;
}

export function CreateApiKeyForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const expiryId = useId();
  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const name = formText(form, 'name');
      const expiry = formText(form, 'expiresInDays');
      const result = await callApi<CreatedApiKeyResponse>(
        `/api/v1/organizations/${organizationId}/api-keys`,
        {
          method: 'POST',
          body: {
            name,
            scopes: ['system:read'],
            ...(expiry ? { expiresInDays: Number(expiry) } : {}),
          },
        },
      );
      if (!result.ok) return { error: result.error, name };
      router.refresh();
      return { created: result.data };
    },
    {},
  );

  return (
    <div className={settings.stack}>
      <form action={formAction} className={ui.form} noValidate>
        {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
          <p className={ui.alert} role="alert">
            {state.error.message}
          </p>
        ) : null}
        <div className={ui.row}>
          <TextField
            label="Name"
            name="name"
            autoComplete="off"
            hint="What uses it, for example “Status monitor”."
            defaultValue={state.name}
            error={fieldErrors(state.error).name}
          />
          <div className={ui.field}>
            <label className={ui.label} htmlFor={expiryId}>
              Expires
            </label>
            <select id={expiryId} name="expiresInDays" className={ui.select} defaultValue="90">
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className={ui.hint}>Scope: system:read</p>
          </div>
        </div>
        <div>
          <button className={ui.button} type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </form>
      {state.created ? (
        <div className={settings.stack} role="status">
          <p className={ui.success}>
            Copy the key now. It is shown only once; VeraRAG keeps only a hash of it.
          </p>
          <CopyField label={`Key “${state.created.apiKey.name}”`} value={state.created.key} />
          <p className={ui.hint}>
            Send it as <code>Authorization: Bearer $VERARAG_API_KEY</code> to{' '}
            <code>/api/v1/system/status</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
