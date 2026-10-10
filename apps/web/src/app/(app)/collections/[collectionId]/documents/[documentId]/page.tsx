import type { CollectionView, DocumentView } from '@verarag/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { FAILURE_LABELS, MEDIA_TYPE_LABELS, STATUS_LABELS } from '@/lib/documents';
import { formatBytes, formatDateTime, formatExactBytes } from '@/lib/format';
import { canManage } from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import styles from '../../../../app.module.css';
import { NoOrganization } from '../../../../settings/no-organization';
import list from '../../../collections.module.css';
import { DeleteDocumentButton } from '../../delete-document-button';

export const metadata: Metadata = { title: 'Document' };

type Params = { params: Promise<{ collectionId: string; documentId: string }> };

export default function DocumentPage({ params }: Params) {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 360 }} />}>
      <Document params={params} />
    </Suspense>
  );
}

async function Document({ params }: Params) {
  const { collectionId, documentId } = await params;
  const session = await requireSession();
  const current = await currentMembership(session);
  if (!current) return <NoOrganization />;

  const base = `/api/v1/organizations/${current.organization.id}`;
  const [document, collection] = await Promise.all([
    serverGet<DocumentView>(`${base}/documents/${documentId}`),
    serverGet<CollectionView>(`${base}/collections/${collectionId}`),
  ]);
  if (!document.ok || document.data.collectionId !== collectionId) {
    return (
      <section className={ui.card}>
        <h2>This document is not available</h2>
        <p>
          It does not exist in {current.organization.name}. It may belong to another organization,
          or have been deleted.
        </p>
        <Link href={`/collections/${collectionId}`}>Back to the collection</Link>
      </section>
    );
  }
  const doc = document.data;

  return (
    <>
      <div className={list.heading}>
        <div>
          <p className={list.breadcrumb}>
            <Link href="/collections">Collections</Link> /{' '}
            <Link href={`/collections/${collectionId}`}>
              {collection.ok ? collection.data.name : 'Collection'}
            </Link>
          </p>
          <h1 className={styles.pageTitle}>{doc.filename}</h1>
        </div>
        <div className={list.rowActions}>
          {doc.status === 'AVAILABLE' ? (
            <a className={ui.button} href={`${base}/documents/${doc.id}/content`} download>
              Download
            </a>
          ) : null}
          {canManage(current.role) ? (
            <DeleteDocumentButton
              organizationId={current.organization.id}
              documentId={doc.id}
              filename={doc.filename}
              redirectTo={`/collections/${collectionId}`}
            />
          ) : null}
        </div>
      </div>

      <section className={ui.card} aria-labelledby="details-title">
        <h2 id="details-title">Details</h2>
        <dl className={list.details}>
          <dt>Status</dt>
          <dd>
            <span className={`${list.status} ${list[doc.status]}`}>
              {STATUS_LABELS[doc.status]}
            </span>
            {doc.status === 'FAILED' && doc.failureReason ? (
              <span className={ui.fieldError}> {FAILURE_LABELS[doc.failureReason]}</span>
            ) : null}
          </dd>
          <dt>File name</dt>
          <dd>{doc.filename}</dd>
          <dt>Type</dt>
          <dd>
            {MEDIA_TYPE_LABELS[doc.mediaType]} <span className={list.mono}>({doc.mediaType})</span>
          </dd>
          <dt>Size</dt>
          <dd>
            {doc.sizeBytes === null
              ? 'Not known until the upload completes'
              : `${formatBytes(doc.sizeBytes)} (${formatExactBytes(doc.sizeBytes)})`}
          </dd>
          <dt>SHA-256</dt>
          <dd className={list.mono}>{doc.sha256 ?? '—'}</dd>
          <dt>Uploaded</dt>
          <dd>{formatDateTime(doc.createdAt)}</dd>
          <dt>Uploaded by</dt>
          <dd>
            {doc.createdBy.type === 'user'
              ? doc.createdBy.displayName
              : `API key “${doc.createdBy.name}”`}
          </dd>
        </dl>
      </section>

      <p className={ui.hint}>
        Downloads are always saved as files, never opened in the browser. Compare the SHA-256 with{' '}
        <code>sha256sum</code> or <code>shasum -a 256</code> to check a download.
      </p>
    </>
  );
}
