'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import ui from '@/components/ui.module.css';
import { callApi } from '@/lib/client-api';

/** Signs out and goes to `redirectTo`, the sign-in page by default. */
export function SignOutButton({ redirectTo = '/login' }: { redirectTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={`${ui.button} ${ui.secondary} ${ui.small}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          // The API clears the cookie even if the session was already gone.
          await callApi('/api/v1/auth/logout', { method: 'POST' });
          router.replace(redirectTo);
          router.refresh();
        })
      }
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
