import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { freshChannel, teardownChannel } from '../integrations/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { foldPresence, presenceKey, type PresenceUser } from './presenceState';

export type { PresenceUser } from './presenceState';

/**
 * Presence on the private per-workspace channel. Realtime Authorization
 * (realtime.messages RLS) only lets members of the workspace join.
 */
export function usePresence(workspaceId: string | null) {
  const { user, profile } = useAuth();
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Identity only. A profile rename must NOT rebuild the channel: the effect
  // below re-tracks the new name instead (see the trackPresence effect). Using
  // the profile fields as dependencies here used to re-subscribe on every auth
  // event, and re-subscribing while the channel was still joining threw
  // `cannot add 'presence' callbacks ... after 'subscribe()'`.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!workspaceId || !userId) {
      setOnline([]);
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    // async because a previous channel with this topic may still be unsubscribing
    void freshChannel(`workspace-presence:${workspaceId}`, {
      config: { presence: { key: presenceKey(userId) }, private: true },
    }).then((created) => {
      if (cancelled) {
        void teardownChannel(created);
        return;
      }
      channel = created;
      created
        .on('presence', { event: 'sync' }, () => {
          if (cancelled) return;
          setOnline(foldPresence(created.presenceState<PresenceUser>()));
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            setConnected(true);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnected(false);
          }
        });
      channelRef.current = created;
    });

    // Listeners are registered BEFORE subscribe() inside the .then(): the client
    // refuses presence handlers once a channel is joining or joined.
    return () => {
      cancelled = true;
      setConnected(false);
      setOnline([]);
      channelRef.current = null;
      if (channel) void teardownChannel(channel);
    };
  }, [workspaceId, userId]);

  // Publish this tab's identity. Also runs when the display name changes so the
  // presence list updates without tearing the channel down.
  const displayName = profile?.display_name ?? 'Teammate';
  const avatarUrl = profile?.avatar_url ?? null;
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !connected || !userId) return;
    void channel.track({
      user_id: userId,
      name: displayName,
      avatar_url: avatarUrl,
      online_at: new Date().toISOString(),
    } satisfies PresenceUser);
  }, [connected, userId, displayName, avatarUrl]);

  return { online, connected };
}
