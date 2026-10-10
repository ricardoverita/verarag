import type { InvitationsResponse, MembersResponse } from '@verarag/contracts';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { formatDate } from '@/lib/format';
import {
  assignableRoles,
  canManage,
  canRemove,
  invitableRoles,
  ROLE_LABELS,
} from '@/lib/organizations';
import { serverGet } from '@/lib/server-api';
import { currentMembership, requireSession } from '@/lib/session';

import styles from '../../app.module.css';
import { NoOrganization } from '../no-organization';
import settings from '../settings.module.css';
import { InviteForm } from './invite-form';
import { MemberActions } from './member-actions';
import { RevokeInvitationButton } from './revoke-invitation-button';

export const metadata: Metadata = { title: 'Members' };

export default function MembersPage() {
  return (
    <Suspense fallback={<div className={ui.skeleton} style={{ height: 360 }} />}>
      <Members />
    </Suspense>
  );
}

async function Members() {
  const session = await requireSession();
  const current = await currentMembership(session);
  if (!current) return <NoOrganization />;

  const id = current.organization.id;
  const manager = canManage(current.role);
  const [members, invitations] = await Promise.all([
    serverGet<MembersResponse>(`/api/v1/organizations/${id}/members`),
    manager ? serverGet<InvitationsResponse>(`/api/v1/organizations/${id}/invitations`) : null,
  ]);
  if (!members.ok) {
    return (
      <p className={ui.alert} role="alert">
        {members.error.message}
      </p>
    );
  }

  return (
    <>
      <div>
        <h1 className={styles.pageTitle}>Members</h1>
        <p className={styles.pageSubtitle}>People with access to {current.organization.name}.</p>
      </div>

      <section className={ui.card} aria-labelledby="members-title">
        <h2 id="members-title">
          {members.data.members.length} {members.data.members.length === 1 ? 'member' : 'members'}
        </h2>
        <ul className={settings.list}>
          {members.data.members.map((member) => {
            const isSelf = member.user.id === session.user.id;
            return (
              <li key={member.id} className={settings.listRow}>
                <div className={settings.person}>
                  <span>
                    {member.user.displayName}
                    {isSelf ? ' (you)' : ''}
                  </span>
                  <span className={settings.secondaryText}>{member.user.email}</span>
                </div>
                <MemberActions
                  organizationId={id}
                  membershipId={member.id}
                  name={member.user.displayName}
                  role={member.role}
                  joined={`Joined ${formatDate(member.joinedAt)}`}
                  roles={assignableRoles(current.role, member.role)}
                  removable={!isSelf && canRemove(current.role, member.role, false)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {manager ? (
        <section className={ui.card} aria-labelledby="invite-title">
          <h2 id="invite-title">Invite someone</h2>
          <p>
            You get a link to send them. It works once, for that email only, and expires in a week.
          </p>
          <InviteForm organizationId={id} roles={invitableRoles(current.role)} />
        </section>
      ) : null}

      {invitations?.ok ? (
        <section className={ui.card} aria-labelledby="invitations-title">
          <h2 id="invitations-title">Pending invitations</h2>
          {invitations.data.invitations.length === 0 ? (
            <p className={settings.empty}>No pending invitations.</p>
          ) : (
            <div className={settings.tableWrap}>
              <table className={settings.table}>
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Expires</th>
                    <th scope="col">
                      <span className={ui.visuallyHidden}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.data.invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>
                        <div className={settings.person}>
                          <span>{invitation.email}</span>
                          <span className={settings.secondaryText}>
                            Invited by {invitation.invitedBy.displayName}
                          </span>
                        </div>
                      </td>
                      <td>{ROLE_LABELS[invitation.role]}</td>
                      <td>
                        <span
                          className={`${ui.badge} ${invitation.status === 'pending' ? settings.active : settings.inactive}`}
                        >
                          {invitation.status === 'pending' ? 'Pending' : 'Expired'}
                        </span>
                      </td>
                      <td>{formatDate(invitation.expiresAt)}</td>
                      <td>
                        <div className={settings.actions}>
                          {invitableRoles(current.role).includes(invitation.role) ? (
                            <RevokeInvitationButton
                              organizationId={id}
                              invitationId={invitation.id}
                              email={invitation.email}
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
      ) : null}
    </>
  );
}
