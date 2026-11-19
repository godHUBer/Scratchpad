import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  // Fail loudly but do not crash rendering of the config-help screen.
  console.error(
    '[scratchpad] Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.',
  );
}

export const supabaseConfigured = Boolean(url && publishableKey);

export const supabaseUrl = url ?? '';
export const supabasePublishableKey = publishableKey ?? '';

export const supabase = createClient<Database>(url ?? 'http://localhost', publishableKey ?? 'anon', {
  auth: {
    // PKCE keeps the OAuth code exchange out of the URL fragment, which plays
    // nicely with HashRouter and survives GitHub Pages reloads.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'scratchpad.auth',
  },
  realtime: { params: { eventsPerSecond: 12 } },
  global: { headers: { 'x-application-name': 'scratchpad' } },
});

/** Base URL the app is served from, always with a trailing slash. */
export function appBasePath(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** Absolute URL Supabase should redirect back to (OAuth + email links). */
export function authRedirectUrl(): string {
  return `${window.location.origin}${appBasePath()}`;
}

/** Build an invitation URL that works locally, in preview and on Pages. */
export function invitationUrl(token: string): string {
  return `${window.location.origin}${appBasePath()}#/invite/${token}`;
}
