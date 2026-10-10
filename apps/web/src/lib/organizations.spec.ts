import type { MembershipSummary } from '@verarag/contracts';
import { describe, expect, it } from 'vitest';

import {
  assignableRoles,
  canManage,
  canRemove,
  invitableRoles,
  isOrganizationId,
  pickMembership,
} from './organizations';

const membership = (id: string): MembershipSummary => ({
  organization: { id, name: id, slug: id, createdAt: '2026-10-10T00:00:00.000Z' },
  role: 'MEMBER',
  joinedAt: '2026-10-10T00:00:00.000Z',
});

describe('pickMembership', () => {
  const memberships = [membership('a'), membership('b')];

  it('uses the preferred organization while the user still belongs to it', () => {
    expect(pickMembership(memberships, 'b')?.organization.id).toBe('b');
  });

  it('falls back to the first organization', () => {
    expect(pickMembership(memberships, 'gone')?.organization.id).toBe('a');
    expect(pickMembership(memberships, undefined)?.organization.id).toBe('a');
  });

  it('returns null without memberships', () => {
    expect(pickMembership([], 'a')).toBeNull();
  });
});

describe('isOrganizationId', () => {
  it('accepts only UUIDs', () => {
    expect(isOrganizationId('0199a7d2-0000-7000-8000-000000000000')).toBe(true);
    expect(isOrganizationId('acme')).toBe(false);
    expect(isOrganizationId(undefined)).toBe(false);
  });
});

describe('canManage', () => {
  it('is for owners and admins', () => {
    expect([
      canManage('OWNER'),
      canManage('ADMIN'),
      canManage('MEMBER'),
      canManage('VIEWER'),
    ]).toEqual([true, true, false, false]);
  });
});

describe('assignableRoles', () => {
  it('mirrors the API rules', () => {
    expect(assignableRoles('OWNER', 'OWNER')).toEqual(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
    expect(assignableRoles('ADMIN', 'MEMBER')).toEqual(['ADMIN', 'MEMBER', 'VIEWER']);
    expect(assignableRoles('ADMIN', 'OWNER')).toEqual([]);
    expect(assignableRoles('MEMBER', 'VIEWER')).toEqual([]);
    expect(invitableRoles('ADMIN')).not.toContain('OWNER');
    expect(invitableRoles('VIEWER')).toEqual([]);
  });
});

describe('canRemove', () => {
  it('lets anyone leave and follows the role rules for others', () => {
    expect(canRemove('VIEWER', 'VIEWER', true)).toBe(true);
    expect(canRemove('ADMIN', 'OWNER', false)).toBe(false);
    expect(canRemove('ADMIN', 'MEMBER', false)).toBe(true);
    expect(canRemove('MEMBER', 'VIEWER', false)).toBe(false);
  });
});
