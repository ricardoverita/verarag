'use client';

import type { MeResponse } from '@verarag/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState } from 'react';

import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { formText } from '@/lib/forms';
import { type ApiError, callApi } from '@/lib/client-api';
import { safeNextPath } from '@/lib/navigation';

interface State {
  error?: ApiError;
  email?: string;
}

export function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));

  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const email = formText(form, 'email');
      const result = await callApi<MeResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: formText(form, 'password') },
      });
      if (!result.ok) {
        return { error: result.error, email };
      }
      router.replace(next);
      router.refresh();
      return {};
    },
    {},
  );

  return (
    <form action={formAction} className={ui.form} noValidate>
      {state.error ? (
        <p className={ui.alert} role="alert">
          {state.error.message}
        </p>
      ) : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={state.email}
      />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" />
      <button className={ui.button} type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
