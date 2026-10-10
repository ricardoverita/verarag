import type { CollectionView, DocumentsResponse, UploadPolicy } from '@verarag/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { FAILURE_LABELS, MEDIA_TYPE_LABELS, STATUS_LABELS } from '@/lib/documents';
import { formatBytes, formatDate } from '@/lib/format';
import { canManage } from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import styles from '../../app.module.css';
import { NoOrganization } from '../../settings/no-organization';
import list from '../collections.module.css';
import { DeleteDocumentButton } from './delete-document-button';
import { EditCollection } from './edit-collection';
import { UploadDocument } from './upload-document';

export const metadata: Metadata = { title: 'Collection' };

type Params = { params: Promise<{ collectionId: string }> };

export default function CollectionPage({ params }: Params) {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 420 }} />}>
      <Collection params={params} />
    </Suspense>
  );
}

async function Collection({ params }: Params) {
  const { collectionId } = await params;
  const session = await requireSession();
  const current = await currentMembership(session);
  if (!current) return <NoOrganization />;

  const base = `/api/v1/organizations/${current.organization.id}`;
  const manager = canManage(current.role);
  const [collection, documents, policy] = await Promise.all([
    serverGet<CollectionView>(`${base}/collections/${collectionId}`),
    serverGet<DocumentsResponse>(`${base}/collections/${collectionId}/documents`),
    manager ? serverGet<UploadPolicy>('/api/v1/documents/upload-policy') : null,
  ]);
  if (!collection.ok || !documents.ok) {
    const error = !collection.ok ? collection.error : !documents.ok ? documents.error : undefined;
    return (
      <section className={ui.card}>
        <h2>This collection is not available</h2>
        <p>
          {error?.code === 'COLLECTION_NOT_FOUND'
            ? `It does not exist in ${current.organization.name}. It may belong to another organization, or have been deleted.`
            : error?.message}
        </p>
        <Link href="/collections">All collections</Link>
      </section>
    );
  }

  return (
    <>
      <div className={list.heading}>
        <div>
          <p className={list.breadcrumb}>
            <Link href="/collections">Collections</Link>
          </p>
          <h1 className={styles.pageTitle}>{collection.data.name}</h1>
          {collection.data.description ? (
            <p className={styles.pageSubtitle}>{collection.data.description}</p>
          ) : null}
        </div>
        {manager ? (
          <EditCollection organizationId={current.organization.id} collection={collection.data} />
        ) : null}
      </div>

      {manager && policy?.ok ? (
        <section className={ui.card} aria-labelledby="upload-title">
          <h2 id="upload-title">Upload a document</h2>
          <UploadDocument
            organizationId={current.organization.id}
            collectionId={collectionId}
            policy={policy.data}
          />
        </section>
      ) : null}

      <section className={ui.card} aria-labelledby="documents-title">
        <h2 id="documents-title">Documents</h2>
        {documents.data.documents.length === 0 ? (
          <p className={list.empty}>
            {manager
              ? 'No documents yet. Upload the first one above.'
              : 'No documents yet. Owners and admins can upload them.'}
          </p>
        ) : (
          <ul className={list.list}>
            {documents.data.documents.map((document) => (
              <li key={document.id} className={list.row}>
                <div className={list.rowMain}>
                  <Link
                    href={`/collections/${collectionId}/documents/${document.id}`}
                    className={list.rowTitle}
                  >
                    {document.filename}
                  </Link>
                  <span className={list.meta}>
                    {MEDIA_TYPE_LABELS[document.mediaType]}
                    {document.sizeBytes !== null
                      ? ` · ${formatBytes(document.sizeBytes)}`
                      : ''} · {formatDate(document.createdAt)} ·{' '}
                    {document.createdBy.type === 'user'
                      ? document.createdBy.displayName
                      : `API key “${document.createdBy.name}”`}
                  </span>
                  {document.status === 'FAILED' && document.failureReason ? (
                    <span className={ui.fieldError}>{FAILURE_LABELS[document.failureReason]}</span>
                  ) : null}
                  {document.status === 'DELETING' ? (
                    <span className={list.meta}>
                      Its file could not be removed yet. Delete it again to finish.
                    </span>
                  ) : null}
                </div>
                <div className={list.rowActions}>
                  <span className={`${list.status} ${list[document.status]}`}>
                    {STATUS_LABELS[document.status]}
                  </span>
                  {document.status === 'AVAILABLE' ? (
                    <a
                      className={`${ui.button} ${ui.secondary} ${ui.small}`}
                      href={`${base}/documents/${document.id}/content`}
                      download
                    >
                      Download
                    </a>
                  ) : null}
                  {manager ? (
                    <DeleteDocumentButton
                      organizationId={current.organization.id}
                      documentId={document.id}
                      filename={document.filename}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
