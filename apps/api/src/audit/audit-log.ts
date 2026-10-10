import { Injectable } from '@nestjs/common';

import type { Queryable } from '../database/database.js';

export type AuditAction =
  | 'USER_REGISTERED'
  | 'USER_LOGGED_IN'
  | 'USER_LOGGED_OUT'
  | 'ORGANIZATION_CREATED'
  | 'ORGANIZATION_UPDATED'
  | 'MEMBER_ROLE_CHANGED'
  | 'MEMBER_REMOVED';

export type AuditResourceType = 'user' | 'session' | 'organization' | 'membership';

export interface AuditEvent {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  organizationId?: string;
  actorUserId?: string;
  /**
   * Small, non-secret context such as a role or a request id. Never
   * passwords, tokens or API keys.
   */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Minimal audit trail for sensitive actions. Callers pass the transaction of
 * the action they record, so the event is stored if and only if the action
 * is.
 */
@Injectable()
export class AuditLog {
  async record(db: Queryable, event: AuditEvent): Promise<void> {
    await db.query(
      `INSERT INTO audit_events
         (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.organizationId ?? null,
        event.actorUserId ?? null,
        event.action,
        event.resourceType,
        event.resourceId ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  }
}
