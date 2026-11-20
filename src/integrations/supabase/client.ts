import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
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

/**
 * Tear a realtime channel down and *wait* for it.
 *
 * `RealtimeClient.channel(topic)` returns the **existing** channel for a topic
 * if one is still registered. `removeChannel()` only unregisters after
 * `unsubscribe()` resolves, and unsubscribe is asynchronous. So this sequence
 * is racy:
 *
 *   cleanup:  void supabase.removeChannel(channel)   // not awaited
 *   next run: supabase.channel(sameTopic)            // reuses the dying one
 *             .on('presence', ...)                   // throws: already subscribed
 *
 * Remembering the in-flight teardown per topic and awaiting it before creating
 * the same topic again closes that hole.
 */
const tearingDown = new Map<string, Promise<unknown>>();

/**
 * Channels we have torn down (or are tearing down) whose teardown has not
 * finished yet. A stale channel can still deliver `presence sync` / `postgres
 * changes` callbacks into a *new* subscription's handlers while it drains, so
 * every handler checks this before touching state.
 */
const retired = new WeakSet<RealtimeChannel>();

/** Guard for callbacks on a channel that may already be on its way out. */
export function isChannelRetired(channel: RealtimeChannel): boolean {
  return retired.has(channel);
}

export function teardownChannel(channel: RealtimeChannel): Promise<unknown> {
  const topic = channel.topic;
  retired.add(channel);
  const pending = supabase.removeChannel(channel).catch((error: unknown) => {
    console.warn('[scratchpad] realtime channel teardown failed', error);
  });
  tearingDown.set(topic, pending);
  void pending.finally(() => {
    if (tearingDown.get(topic) === pending) tearingDown.delete(topic);
  });
  return pending;
}

/**
 * Get a channel for `topic`, waiting for any in-flight teardown of the same
 * topic first. Always returns a channel that is safe to `.on()` + `.subscribe()`.
 */
export async function freshChannel(
  topic: string,
  options?: Parameters<typeof supabase.channel>[1],
): Promise<RealtimeChannel> {
  const pending = tearingDown.get(topic);
  if (pending) await pending.catch(() => undefined);
  return options ? supabase.channel(topic, options) : supabase.channel(topic);
}
