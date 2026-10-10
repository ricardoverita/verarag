'use client';

import type { MembershipSummary } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useActionState } from 'react';

import { selectOrganization } from '@/app/(app)/actions';
import { formText } from '@/lib/forms';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';

import { TextField } from './text-field';
import ui from './ui.module.css';

interface State {
  error?: ApiError;
  name?: string;
}

/** Creates an organization with the user as owner, and switches to it. */
export function CreateOrganizationForm() {
  const router = useRouter();

  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const name = formText(form, 'name');
      const result = await callApi<MembershipSummary>('/api/v1/organizations', {
        method: 'POST',
        body: { name },
      });
      if (!result.ok) {
        return { error: result.error, name };
      }
      await selectOrganization(result.data.organization.id);
      router.push('/dashboard');
      return {};
    },
    {},
  );

  return (
    <form action={formAction} className={ui.form} noValidate>
      {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
        <p className={ui.alert} role="alert">
          {state.error.message}
        </p>
      ) : null}
      <TextField
        label="Organization name"
        name="name"
        autoComplete="organization"
        defaultValue={state.name}
        error={fieldErrors(state.error).name}
      />
      <div>
        <button className={ui.button} type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create organization'}
        </button>
      </div>
    </form>
  );
}
