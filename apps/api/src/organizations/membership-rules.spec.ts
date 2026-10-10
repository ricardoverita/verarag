import { describe, expect, it } from 'vitest';

import { AppError } from '../common/app-error.js';
import {
  assertCanChangeRole,
  assertCanInvite,
  assertCanRemoveMember,
  assertOwnerRemains,
} from './membership-rules.js';
import type { Role } from './roles.js';

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'unexpected';
  }
}

describe('assertCanChangeRole', () => {
  it.each<[Role, Role, Role, string | undefined]>([
    ['OWNER', 'MEMBER', 'OWNER', undefined],
    ['OWNER', 'OWNER', 'ADMIN', undefined],
    ['ADMIN', 'MEMBER', 'ADMIN', undefined],
    ['ADMIN', 'ADMIN', 'VIEWER', undefined],
    ['ADMIN', 'MEMBER', 'OWNER', 'INSUFFICIENT_ROLE'],
    ['ADMIN', 'OWNER', 'MEMBER', 'INSUFFICIENT_ROLE'],
    ['MEMBER', 'VIEWER', 'MEMBER', 'INSUFFICIENT_ROLE'],
    ['VIEWER', 'VIEWER', 'MEMBER', 'INSUFFICIENT_ROLE'],
  ])('%s changing %s to %s → %s', (actor, current, next, expected) => {
    expect(codeOf(() => assertCanChangeRole(actor, current, next))).toBe(expected);
  });
});

describe('assertCanInvite', () => {
  it.each<[Role, Role, string | undefined]>([
    ['OWNER', 'OWNER', undefined],
    ['OWNER', 'VIEWER', undefined],
    ['ADMIN', 'ADMIN', undefined],
    ['ADMIN', 'OWNER', 'INSUFFICIENT_ROLE'],
    ['MEMBER', 'VIEWER', 'INSUFFICIENT_ROLE'],
    ['VIEWER', 'VIEWER', 'INSUFFICIENT_ROLE'],
  ])('%s inviting as %s → %s', (actor, role, expected) => {
    expect(codeOf(() => assertCanInvite(actor, role))).toBe(expected);
  });
});

describe('assertCanRemoveMember', () => {
  const me = (role: Role) => ({ membershipId: 'me', role });
  const them = (role: Role) => ({ membershipId: 'them', role });

  it('lets anyone leave', () => {
    expect(codeOf(() => assertCanRemoveMember(me('VIEWER'), me('VIEWER')))).toBeUndefined();
  });

  it('lets owners remove anyone and admins remove everyone but owners', () => {
    expect(codeOf(() => assertCanRemoveMember(me('OWNER'), them('OWNER')))).toBeUndefined();
    expect(codeOf(() => assertCanRemoveMember(me('ADMIN'), them('MEMBER')))).toBeUndefined();
    expect(codeOf(() => assertCanRemoveMember(me('ADMIN'), them('OWNER')))).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(codeOf(() => assertCanRemoveMember(me('MEMBER'), them('VIEWER')))).toBe(
      'INSUFFICIENT_ROLE',
    );
  });
});

describe('assertOwnerRemains', () => {
  it('refuses to demote or remove the last owner', () => {
    expect(codeOf(() => assertOwnerRemains(1, 'OWNER', 'ADMIN'))).toBe('LAST_OWNER');
    expect(codeOf(() => assertOwnerRemains(1, 'OWNER', 'removed'))).toBe('LAST_OWNER');
  });

  it('allows it when another owner remains', () => {
    expect(codeOf(() => assertOwnerRemains(2, 'OWNER', 'MEMBER'))).toBeUndefined();
    expect(codeOf(() => assertOwnerRemains(2, 'OWNER', 'removed'))).toBeUndefined();
  });

  it('does not care about changes that keep the owner or affect other roles', () => {
    expect(codeOf(() => assertOwnerRemains(1, 'OWNER', 'OWNER'))).toBeUndefined();
    expect(codeOf(() => assertOwnerRemains(1, 'ADMIN', 'removed'))).toBeUndefined();
  });
});
