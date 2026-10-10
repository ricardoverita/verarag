import type { CollectionsResponse } from '@verarag/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { formatDate } from '@/lib/format';
import { canManage } from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import styles from '../app.module.css';
import { NoOrganization } from '../settings/no-organization';
import list from './collections.module.css';
import { CreateCollectionForm } from './create-collection-form';

export const metadata: Metadata = { title: 'Collections' };

export default function CollectionsPage() {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 320 }} />}>
      <Collections />
    </Suspense>
  );
}

async function Collections() {
  const session = await requireSession();
  const current = await currentMembership(session);
  if (!current) return <NoOrganization />;

  const result = await serverGet<CollectionsResponse>(
    `/api/v1/organizations/${current.organization.id}/collections`,
  );
  if (!result.ok) {
    return (
      <p className={ui.alert} role="alert">
        {result.error.message}
      </p>
    );
  }
  const { collections } = result.data;
  const manager = canManage(current.role);

  return (
    <>
      <div>
        <h1 className={styles.pageTitle}>Collections</h1>
        <p className={styles.pageSubtitle}>
          Collections group the documents of {current.organization.name}. Everyone in the
          organization can see them{manager ? '; owners and admins manage them' : ''}.
        </p>
      </div>

      {manager ? (
        <section className={ui.card} aria-labelledby="create-title">
          <h2 id="create-title">New collection</h2>
          <CreateCollectionForm organizationId={current.organization.id} />
        </section>
      ) : null}

      <section className={ui.card} aria-labelledby="collections-title">
        <h2 id="collections-title">
          {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
        </h2>
        {collections.length === 0 ? (
          <p className={list.empty}>
            {manager
              ? 'There are no collections yet. Create one to start uploading documents.'
              : 'There are no collections yet. Owners and admins can create them.'}
          </p>
        ) : (
          <ul className={list.list}>
            {collections.map((collection) => (
              <li key={collection.id} className={list.row}>
                <div className={list.rowMain}>
                  <Link href={`/collections/${collection.id}`} className={list.rowTitle}>
                    {collection.name}
                  </Link>
                  {collection.description ? (
                    <span className={list.meta}>{collection.description}</span>
                  ) : null}
                </div>
                <span className={list.meta}>
                  {collection.documentCount}{' '}
                  {collection.documentCount === 1 ? 'document' : 'documents'} · created{' '}
                  {formatDate(collection.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
