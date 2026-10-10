import Link from 'next/link';

import styles from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.wordmark}>
        VeraRAG
      </Link>
      {children}
    </main>
  );
}
