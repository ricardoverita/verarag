'use client';

import type { CreatedInvitationResponse, MemberRole } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useActionState, useId } from 'react';

import { CopyField } from '@/components/copy-field';
import { TextField } from '@/components/text-field';
import ui from '@/components/ui.module.css';
import { type ApiError, callApi, fieldErrors } from '@/lib/client-api';
import { formatDate } from '@/lib/format';
import { formText } from '@/lib/forms';
import { ROLE_LABELS } from '@/lib/organizations';

import styles from './members.module.css';

interface State {
  error?: ApiError;
  email?: string;
  role?: string;
  created?: CreatedInvitationResponse;
}

export function InviteForm({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: MemberRole[];
}) {
  const router = useRouter();
  const roleId = useId();
  const [state, formAction, pending] = useActionState(
    async (_previous: State, form: FormData): Promise<State> => {
      const email = formText(form, 'email');
      const role = formText(form, 'role');
      const result = await callApi<CreatedInvitationResponse>(
        `/api/v1/organizations/${organizationId}/invitations`,
        { method: 'POST', body: { email, role } },
      );
      if (!result.ok) return { error: result.error, email, role };
      router.refresh();
      return { created: result.data, role };
    },
    {},
  );
  const errors = fieldErrors(state.error);

  return (
    <>
      <form action={formAction} className={ui.form} noValidate>
        {state.error && state.error.code !== 'VALIDATION_FAILED' ? (
          <p className={ui.alert} role="alert">
            {state.error.message}
          </p>
        ) : null}
        <div className={ui.row}>
          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={state.email}
            error={errors.email}
          />
          <div className={ui.field}>
            <label className={ui.label} htmlFor={roleId}>
              Role
            </label>
            <select
              id={roleId}
              name="role"
              className={ui.select}
              defaultValue={state.role ?? 'MEMBER'}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <button className={ui.button} type="submit" disabled={pending}>
            {pending ? 'Creating link…' : 'Create invitation'}
          </button>
        </div>
      </form>
      {state.created ? (
        <div className={styles.inviteResult} role="status">
          <p className={ui.success}>
            Send this link to {state.created.invitation.email}. It is shown only once and works
            until {formatDate(state.created.invitation.expiresAt)}.
          </p>
          <CopyField label="Invitation link" value={state.created.inviteUrl} />
        </div>
      ) : null}
    </>
  );
}
