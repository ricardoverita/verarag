import type { ActorView } from '@verarag/contracts';

/** Who performs an action inside an organization: a member or one of its API keys. */
export type Actor = { type: 'user'; userId: string } | { type: 'apiKey'; apiKeyId: string };

/** The pair of nullable columns that record an actor, exactly one of them set. */
export function actorColumns(actor: Actor): { userId: string | null; apiKeyId: string | null } {
  return actor.type === 'user'
    ? { userId: actor.userId, apiKeyId: null }
    : { userId: null, apiKeyId: actor.apiKeyId };
}

/** SQL columns and joins that read an actor back, for a table aliased as `alias`. */
export function actorSql(alias: string): { columns: string; joins: string } {
  return {
    columns: `${alias}.created_by_user_id, actor_user.display_name AS actor_user_name,
      ${alias}.created_by_api_key_id, actor_key.name AS actor_api_key_name`,
    joins: `LEFT JOIN users actor_user ON actor_user.id = ${alias}.created_by_user_id
      LEFT JOIN api_keys actor_key ON actor_key.id = ${alias}.created_by_api_key_id`,
  };
}

export interface ActorRow {
  created_by_user_id: string | null;
  actor_user_name: string | null;
  created_by_api_key_id: string | null;
  actor_api_key_name: string | null;
}

export function toActorView(row: ActorRow): ActorView {
  if (row.created_by_user_id) {
    return { type: 'user', id: row.created_by_user_id, displayName: row.actor_user_name ?? '' };
  }
  return {
    type: 'apiKey',
    id: row.created_by_api_key_id ?? '',
    name: row.actor_api_key_name ?? '',
  };
}

/** An action inside one organization: who does it and the request it belongs to. */
export interface ActionContext {
  organizationId: string;
  actor: Actor;
  requestId?: string;
}

/** The audit columns for an actor. */
export function auditActor(actor: Actor): { actorUserId?: string } {
  return actor.type === 'user' ? { actorUserId: actor.userId } : {};
}
