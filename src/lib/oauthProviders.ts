/**
 * Which social sign-in buttons to show.
 *
 * The browser can ask the auth server what it has switched on:
 *
 *   GET <project>/auth/v1/settings  ->  { "external": { "google": false, ... } }
 *
 * That endpoint is public (it needs nothing but the publishable key), and it is
 * the only trustworthy answer to "is Google actually usable right now?". Trying
 * an OAuth start against a disabled provider does not fail in the client — the
 * library redirects, Google rejects the request, and the user lands back on an
 * error page with no explanation. Asking first lets us keep the button honest.
 */

export type OAuthProviderName = 'google' | 'github';

export interface OAuthProviderState {
  name: OAuthProviderName;
  label: string;
  enabled: boolean;
}

const DEFAULTS: Record<OAuthProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
};

/** Shape of the subset of `/auth/v1/settings` we care about. */
export interface AuthSettingsPayload {
  external?: Record<string, unknown> | null;
}

/**
 * Pure: map a settings payload onto button state.
 *
 * Anything other than an explicit `true` counts as off — a missing key, a null,
 * or a string all mean we would be guessing, and a button that silently fails
 * is worse than one that says "not set up yet".
 */
export function readProviderStates(payload: AuthSettingsPayload | null | undefined): OAuthProviderState[] {
  const external = payload?.external ?? {};
  return (Object.keys(DEFAULTS) as OAuthProviderName[]).map((name) => ({
    name,
    label: DEFAULTS[name],
    enabled: external[name] === true,
  }));
}

/** Every provider off — used before the fetch resolves and if it fails. */
export function allProvidersOff(): OAuthProviderState[] {
  return readProviderStates(null);
}

/**
 * The URL an operator has to register with Google / GitHub. Surfaced in the UI
 * so setup is a copy-paste rather than a hunt through the README.
 */
export function oauthCallbackUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/callback`;
}

/**
 * A failed start still tells us *why*. These are the ones worth naming, because
 * each has a different fix that the operator can act on.
 */
export function oauthFailureMessage(message: string): string | null {
  const text = (message ?? '').toLowerCase();
  if (!text.trim()) return null;
  if (text.includes('provider is not enabled') || text.includes('unsupported provider')) {
    return 'That sign-in method is not switched on for this project yet.';
  }
  if (text.includes('redirect_uri_mismatch') || text.includes('redirect uri')) {
    return 'The OAuth app is missing this site\u2019s callback URL.';
  }
  if (text.includes('access_denied')) {
    return 'Sign-in was cancelled.';
  }
  return null;
}
