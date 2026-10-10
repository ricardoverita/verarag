import type { Metadata } from 'next';

import { CreateOrganizationForm } from '@/components/create-organization-form';
import ui from '@/components/ui.module.css';

import styles from '../../app.module.css';

export const metadata: Metadata = { title: 'New organization' };

export default function NewOrganizationPage() {
  return (
    <>
      <div>
        <h1 className={styles.pageTitle}>New organization</h1>
        <p className={styles.pageSubtitle}>
          You will be its owner. Its documents and members stay separate from your other
          organizations.
        </p>
      </div>
      <section className={ui.card}>
        <CreateOrganizationForm />
      </section>
    </>
  );
}
