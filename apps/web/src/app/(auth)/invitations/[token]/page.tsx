import type { InvitationPreview } from '@verarag/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import ui from '@/components/ui.module.css';
import { formatDate } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/organizations';
import { serverRequest } from '@/lib/server-api';
import { getSession } from '@/lib/session';

import styles from '../../auth.module.css';
import { AcceptInvitationButton } from './accept-invitation-button';
import { RegisterWithInvitationForm } from './register-with-invitation-form';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } };

export default function InvitationPage({ params }: PageProps<'/invitations/[token]'>) {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 280 }} />}>
      <Invitation params={params} />
    </Suspense>
  );
}

async function Invitation({ params }: { params: PageProps<'/invitations/[token]'>['params'] }) {
  const { token } = await params;
  // The token goes to the API in a request body, never in a URL it would log.
  const [preview, session] = await Promise.all([
    serverRequest<InvitationPreview>('/api/v1/invitations/preview', {
      method: 'POST',
      body: { token },
    }),
    getSession(),
  ]);

  if (!preview.ok) {
    return (
      <>
        <h1 className={styles.title}>This invitation cannot be used</h1>
        <p className={ui.alert} role="alert">
          {preview.error.message}
        </p>
        <p className={styles.switch}>
          Ask the person who invited you for a new link, or <Link href="/">go to VeraRAG</Link>.
        </p>
      </>
    );
  }

  const invitation = preview.data;
  const loginPath = `/login?next=${encodeURIComponent(`/invitations/${token}`)}`;

  return (
    <>
      <div>
        <h1 className={styles.title}>Join {invitation.organization.name}</h1>
        <p className={styles.subtitle}>
          {invitation.invitedBy.displayName} invited {invitation.email} to join as{' '}
          {ROLE_LABELS[invitation.role].toLowerCase()}. The invitation works until{' '}
          {formatDate(invitation.expiresAt)}.
        </p>
      </div>

      {session && session.user.email === invitation.email ? (
        <section className={ui.card}>
          <AcceptInvitationButton token={token} organizationName={invitation.organization.name} />
        </section>
      ) : session ? (
        <section className={ui.card}>
          <p className={ui.alert}>
            You are signed in as {session.user.email}, but this invitation is for {invitation.email}
            . Sign out and sign in with that email to accept it.
          </p>
          <div style={{ marginTop: 16 }}>
            <SignOutButton redirectTo={loginPath} />
          </div>
        </section>
      ) : (
        <>
          <section className={ui.card}>
            <h2>Create your account</h2>
            <RegisterWithInvitationForm
              token={token}
              email={invitation.email}
              loginPath={loginPath}
            />
          </section>
          <p className={styles.switch}>
            Already have an account with {invitation.email}?{' '}
            <Link href={loginPath}>Sign in to accept</Link>
          </p>
        </>
      )}
    </>
  );
}
