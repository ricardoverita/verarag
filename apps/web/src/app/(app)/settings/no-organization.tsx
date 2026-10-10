import Link from 'next/link';

import ui from '@/components/ui.module.css';

export function NoOrganization() {
  return (
    <section className={ui.card}>
      <h2>No organization yet</h2>
      <p>Create an organization or accept an invitation to see its settings.</p>
      <Link href="/organizations/new" className={ui.button}>
        Create an organization
      </Link>
    </section>
  );
}
