import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';

import styles from '../auth.module.css';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <>
      <div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Use the email and password of your VeraRAG account.</p>
      </div>
      <section className={ui.card}>
        {/* The form reads ?next= from the URL, which is only known per request. */}
        <Suspense fallback={<div className={ui.skeleton} style={{ height: 220 }} />}>
          <LoginForm />
        </Suspense>
      </section>
      <p className={styles.switch}>
        New to VeraRAG? <Link href="/register">Create an account</Link>
      </p>
    </>
  );
}
