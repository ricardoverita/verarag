import type { ApiKeysResponse, ApiKeyStatus } from '@verarag/contracts';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { formatDate, formatDateTime } from '@/lib/format';
import { canManage } from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import styles from '../../app.module.css';
import { NoOrganization } from '../no-organization';
import settings from '../settings.module.css';
import { CreateApiKeyForm } from './create-api-key-form';
import { RevokeApiKeyButton } from './revoke-api-key-button';

export const metadata: Metadata = { title: 'API keys' };

const STATUS_LABELS: Record<ApiKeyStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

export default function ApiKeysPage() {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 320 }} />}>
      <ApiKeys />
    </Suspense>
  );
}

async function ApiKeys() {
  const session = await requireSession();
  const current = await currentMembership(session);
  if (!current) return <NoOrganization />;

  const heading = (
    <div>
      <h1 className={styles.pageTitle}>API keys</h1>
      <p className={styles.pageSubtitle}>
        Keys let programs call VeraRAG on behalf of {current.organization.name}. Today they can only
        read the system status.
      </p>
    </div>
  );
  if (!canManage(current.role)) {
    return (
      <>
        {heading}
        <p className={ui.alert}>Only owners and admins can see and manage API keys.</p>
      </>
    );
  }

  const id = current.organization.id;
  const keys = await serverGet<ApiKeysResponse>(`/api/v1/organizations/${id}/api-keys`);
  if (!keys.ok) {
    return (
      <p className={ui.alert} role="alert">
        {keys.error.message}
      </p>
    );
  }

  return (
    <>
      {heading}

      <section className={ui.card} aria-labelledby="create-title">
        <h2 id="create-title">Create a key</h2>
        <CreateApiKeyForm organizationId={id} />
      </section>

      <section className={ui.card} aria-labelledby="keys-title">
        <h2 id="keys-title">Keys</h2>
        {keys.data.apiKeys.length === 0 ? (
          <p className={settings.empty}>This organization has no API keys yet.</p>
        ) : (
          <div className={settings.tableWrap}>
            <table className={settings.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Expires</th>
                  <th scope="col">
                    <span className={ui.visuallyHidden}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.data.apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <div className={settings.person}>
                        <span>{key.name}</span>
                        <span className={`${settings.secondaryText} ${settings.mono}`}>
                          {key.prefix}…
                        </span>
                        <span className={settings.secondaryText}>
                          By {key.createdBy.displayName} on {formatDate(key.createdAt)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`${ui.badge} ${key.status === 'active' ? settings.active : settings.inactive}`}
                      >
                        {STATUS_LABELS[key.status]}
                      </span>
                    </td>
                    <td className={settings.secondaryText}>
                      {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Never'}
                    </td>
                    <td className={settings.secondaryText}>
                      {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}
                    </td>
                    <td>
                      <div className={settings.actions}>
                        {key.status === 'active' ? (
                          <RevokeApiKeyButton
                            organizationId={id}
                            apiKeyId={key.id}
                            name={key.name}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
