'use client';

import type { RegisterResponse } from '@verarag/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState } from 'react';

import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { formText } from '@/lib/forms';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { HOME_PATH } from '@/lib/navigation';

interface State {
  error?: ApiError;
  values?: Record<string, string>;
}

export function RegisterForm() {
  const router = useRouter();

  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const values = {
        displayName: formText(form, 'displayName'),
        email: formText(form, 'email'),
        organizationName: formText(form, 'organizationName'),
      };
      const result = await callApi<RegisterResponse>('/api/v1/auth/register', {
        method: 'POST',
        body: { ...values, password: formText(form, 'password') },
      });
      if (!result.ok) {
        return { error: result.error, values };
      }
      router.replace(HOME_PATH);
      router.refresh();
      return {};
    },
    {},
  );
  const errors = fieldErrors(state.error);

  return (
    <form action={formAction} className={ui.form} noValidate>
      {state.error ? (
        <p className={ui.alert} role="alert">
          {state.error.code === 'VALIDATION_FAILED'
            ? 'Check the highlighted fields.'
            : state.error.message}{' '}
          {state.error.code === 'EMAIL_UNAVAILABLE' ? (
            <Link href="/login">Sign in instead</Link>
          ) : null}
        </p>
      ) : null}
      <TextField
        label="Your name"
        name="displayName"
        autoComplete="name"
        defaultValue={state.values?.displayName}
        error={errors.displayName}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={errors.email}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters. A few unrelated words work well."
        error={errors.password}
      />
      <TextField
        label="Organization name"
        name="organizationName"
        autoComplete="organization"
        hint="Your company or team. You can rename it later."
        defaultValue={state.values?.organizationName}
        error={errors.organizationName}
      />
      <button className={ui.button} type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </button>
    </form>
  );
}
