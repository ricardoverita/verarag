'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './app.module.css';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', managersOnly: false },
  { href: '/settings/organization', label: 'Organization', managersOnly: false },
  { href: '/settings/members', label: 'Members', managersOnly: false },
  { href: '/settings/api-keys', label: 'API keys', managersOnly: true },
] as const;

export function NavLinks({
  hasOrganization,
  canManage,
}: {
  hasOrganization: boolean;
  canManage: boolean;
}) {
  const pathname = usePathname();
  const links = LINKS.filter(
    (link) => link.href === '/dashboard' || (hasOrganization && (!link.managersOnly || canManage)),
  );

  return (
    <nav className={styles.nav} aria-label="Main">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={styles.navLink}
          aria-current={pathname === link.href ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
