import { describe, expect, it } from 'vitest';
import { adminLoginMessage } from './useAdminConsole';

describe('adminLoginMessage', () => {
  it('explains a lockout', () => {
    expect(adminLoginMessage('locked')).toMatch(/too many wrong keys/i);
  });

  it('explains an unconfigured server', () => {
    expect(adminLoginMessage('unconfigured')).toMatch(/no admin key/i);
  });

  it('explains a wrong key', () => {
    expect(adminLoginMessage('bad_key')).toMatch(/not right/i);
  });

  it('falls back for an unknown or missing reason', () => {
    expect(adminLoginMessage(null)).toMatch(/could not start/i);
    expect(adminLoginMessage(undefined)).toMatch(/could not start/i);
    expect(adminLoginMessage('something-new')).toMatch(/could not start/i);
  });
});
