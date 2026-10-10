import Link from 'next/link';

import { SignOutButton } from '@/components/sign-out-button';
import ui from '@/components/ui.module.css';
import { canManage } from '@/lib/organizations';
import { currentMembership, requireSession } from '@/lib/session';

import styles from './app.module.css';
import { NavLinks } from './nav-links';
import { OrganizationSwitcher } from './organization-switcher';

export async function AppHeader() {
  const session = await requireSession();
  const current = await currentMembership(session);

  return (
    <div className={styles.headerInner}>
      <Link href="/dashboard" className={styles.wordmark}>
        VeraRAG
      </Link>
      {current ? (
        <OrganizationSwitcher
          memberships={session.memberships}
          currentId={current.organization.id}
        />
      ) : null}
      <NavLinks
        hasOrganization={current !== null}
        canManage={current ? canManage(current.role) : false}
      />
      <div className={styles.user}>
        <span title={session.user.email}>{session.user.displayName}</span>
        <SignOutButton />
      </div>
    </div>
  );
}

export function AppHeaderPlaceholder() {
  return (
    <div className={styles.headerInner} aria-busy="true">
      <span className={styles.wordmark}>VeraRAG</span>
      <div className={ui.skeleton} style={{ width: 180, height: 34 }} />
    </div>
  );
}
