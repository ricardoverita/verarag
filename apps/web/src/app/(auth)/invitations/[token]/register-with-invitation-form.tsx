'use client';

import type { RegisterResponse } from '@verarag/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useId } from 'react';

import { selectOrganization } from '@/app/(app)/actions';
import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { formText } from '@/lib/forms';

interface State {
  error?: ApiError;
  displayName?: string;
}

/** Creates the account for the invited email and joins in one step. */
export function RegisterWithInvitationForm({
  token,
  email,
  loginPath,
}: {
  token: string;
  email: string;
  loginPath: string;
}) {
  const router = useRouter();
  const emailId = useId();
  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const displayName = formText(form, 'displayName');
      const result = await callApi<RegisterResponse>('/api/v1/invitations/register', {
        method: 'POST',
        body: { token, displayName, password: formText(form, 'password') },
      });
      if (!result.ok) return { error: result.error, displayName };
      await selectOrganization(result.data.organization.id);
      router.replace('/dashboard');
      router.refresh();
      return {};
    },
    {},
  );
  const errors = fieldErrors(state.error);

  return (
    <form action={formAction} className={ui.form} noValidate>
      {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
        <p className={ui.alert} role="alert">
          {state.error.code === 'EMAIL_UNAVAILABLE'
            ? `There is already an account for ${email}. `
            : `${state.error.message} `}
          {state.error.code === 'EMAIL_UNAVAILABLE' ? (
            <Link href={loginPath}>Sign in to accept</Link>
          ) : null}
        </p>
      ) : null}
      <div className={ui.field}>
        <label className={ui.label} htmlFor={emailId}>
          Email
        </label>
        <input className={ui.input} id={emailId} value={email} readOnly autoComplete="username" />
        <p className={ui.hint}>The invitation is for this email.</p>
      </div>
      <TextField
        label="Your name"
        name="displayName"
        autoComplete="name"
        defaultValue={state.displayName}
        error={errors.displayName}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        error={errors.password}
      />
      <button className={ui.button} type="submit" disabled={pending}>
        {pending ? 'Joining…' : 'Create account and join'}
      </button>
    </form>
  );
}
