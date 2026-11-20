import { describe, expect, it } from 'vitest';
import {
  allProvidersOff,
  oauthCallbackUrl,
  oauthFailureMessage,
  readProviderStates,
} from './oauthProviders';

/**
 * The bug this guards: the Google button was always rendered, but the provider
 * was never enabled on the project, so pressing it produced a bare
 * "Provider not enabled" redirect page.
 */
describe('readProviderStates', () => {
  it('reports both providers on when the auth server says so', () => {
    const states = readProviderStates({ external: { google: true, github: true } });
    expect(states.map((s) => [s.name, s.enabled])).toEqual([
      ['google', true],
      ['github', true],
    ]);
  });

  it('treats a disabled provider as off', () => {
    const states = readProviderStates({ external: { google: false, github: true } });
    expect(states.find((s) => s.name === 'google')?.enabled).toBe(false);
    expect(states.find((s) => s.name === 'github')?.enabled).toBe(true);
  });

  it('does not guess: anything but true is off', () => {
    const states = readProviderStates({ external: { google: 'true', github: null } });
    expect(states.every((s) => s.enabled === false)).toBe(true);
  });

  it('survives a missing or empty payload', () => {
    expect(readProviderStates({}).every((s) => !s.enabled)).toBe(true);
    expect(readProviderStates({ external: null }).every((s) => !s.enabled)).toBe(true);
    expect(allProvidersOff().every((s) => !s.enabled)).toBe(true);
  });

  it('always returns both buttons, in a stable order', () => {
    expect(readProviderStates(null).map((s) => s.label)).toEqual(['Google', 'GitHub']);
  });
});

describe('oauthCallbackUrl', () => {
  it('points at the Supabase auth callback, which is what goes in the OAuth app', () => {
    expect(oauthCallbackUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co/auth/v1/callback');
  });

  it('does not double up slashes', () => {
    expect(oauthCallbackUrl('https://abc.supabase.co/')).toBe('https://abc.supabase.co/auth/v1/callback');
  });
});

describe('oauthFailureMessage', () => {
  it('explains a disabled provider', () => {
    expect(oauthFailureMessage('Provider is not enabled')).toMatch(/not switched on/i);
  });

  it('explains a redirect URI mismatch', () => {
    expect(oauthFailureMessage('redirect_uri_mismatch from Google')).toMatch(/callback URL/i);
  });

  it('treats a cancelled consent screen as a cancellation', () => {
    expect(oauthFailureMessage('access_denied')).toMatch(/cancelled/i);
  });

  it('returns null for errors it does not recognise, so the caller can fall back', () => {
    expect(oauthFailureMessage('some other failure')).toBeNull();
    expect(oauthFailureMessage('')).toBeNull();
  });
});
