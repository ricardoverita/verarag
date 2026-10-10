import type { Metadata } from 'next';
import Link from 'next/link';

import ui from '@/components/ui.module.css';

import styles from '../auth.module.css';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Create an account' };

export default function RegisterPage() {
  return (
    <>
      <div>
        <h1 className={styles.title}>Create an account</h1>
        <p className={styles.subtitle}>
          You also get your first organization, where you are the owner.
        </p>
      </div>
      <section className={ui.card}>
        <RegisterForm />
      </section>
      <p className={styles.switch}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
