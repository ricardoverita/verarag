import { describe, expect, it } from 'vitest';

import { safeNextPath } from './navigation';

describe('safeNextPath', () => {
  it('keeps paths inside the app', () => {
    expect(safeNextPath('/settings/members')).toBe('/settings/members');
    expect(safeNextPath('/invitations/abc?x=1')).toBe('/invitations/abc?x=1');
  });

  it('falls back to the dashboard for anything that could leave it', () => {
    for (const value of [
      null,
      undefined,
      '',
      'dashboard',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      expect(safeNextPath(value)).toBe('/dashboard');
    }
  });
});
