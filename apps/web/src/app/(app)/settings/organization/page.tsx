import type { MembersResponse, OrganizationDetail } from '@verarag/contracts';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { formatDate } from '@/lib/format';
import { canManage, ROLE_LABELS } from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import styles from '../../app.module.css';
import { NoOrganization } from '../no-organization';
import settings from '../settings.module.css';
import { LeaveOrganization } from './leave-organization';
import { RenameOrganizationForm } from './rename-organization-form';

export const metadata: Metadata = { title: 'Organization' };

export default function OrganizationSettingsPage() {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 320 }} />}>
      <OrganizationSettings />
    </Suspense>
  );
}

async function OrganizationSettings() {
  const session = await requireSession();
  const current = await currentMembership(session);
  if (!current) return <NoOrganization />;

  const id = current.organization.id;
  const [detail, members] = await Promise.all([
    serverGet<OrganizationDetail>(`/api/v1/organizations/${id}`),
    serverGet<MembersResponse>(`/api/v1/organizations/${id}/members`),
  ]);
  if (!detail.ok || !members.ok) {
    const error = !detail.ok ? detail.error : !members.ok ? members.error : undefined;
    return (
      <p className={ui.alert} role="alert">
        {error?.message}
      </p>
    );
  }
  const { organization, role, memberCount } = detail.data;
  const me = members.data.members.find((member) => member.user.id === session.user.id);

  return (
    <>
      <div>
        <h1 className={styles.pageTitle}>Organization</h1>
        <p className={styles.pageSubtitle}>Settings of {organization.name}.</p>
      </div>

      <section className={ui.card} aria-labelledby="details-title">
        <h2 id="details-title">Details</h2>
        <dl className={settings.details}>
          <dt>Name</dt>
          <dd>{organization.name}</dd>
          <dt>Identifier</dt>
          <dd className={settings.mono}>{organization.slug}</dd>
          <dt>Created</dt>
          <dd>{formatDate(organization.createdAt)}</dd>
          <dt>Members</dt>
          <dd>{memberCount}</dd>
          <dt>Your role</dt>
          <dd>{ROLE_LABELS[role]}</dd>
        </dl>
      </section>

      {canManage(role) ? (
        <section className={ui.card} aria-labelledby="rename-title">
          <h2 id="rename-title">Rename</h2>
          <p>The identifier stays the same, so existing links keep working.</p>
          <RenameOrganizationForm organizationId={organization.id} name={organization.name} />
        </section>
      ) : null}

      {me ? (
        <section className={ui.card} aria-labelledby="leave-title">
          <h2 id="leave-title">Leave the organization</h2>
          <p>
            You will lose access to {organization.name} until someone invites you again.
            {role === 'OWNER'
              ? ' If you are the only owner, make someone else an owner first.'
              : ''}
          </p>
          <LeaveOrganization
            organizationId={organization.id}
            membershipId={me.id}
            organizationName={organization.name}
          />
        </section>
      ) : null}
    </>
  );
}
