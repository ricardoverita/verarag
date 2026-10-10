import { Suspense } from 'react';

import { AppHeader, AppHeaderPlaceholder } from './app-header';
import styles from './app.module.css';

/** The signed-in part of the app. Pages check the session themselves too. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Suspense fallback={<AppHeaderPlaceholder />}>
          <AppHeader />
        </Suspense>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
