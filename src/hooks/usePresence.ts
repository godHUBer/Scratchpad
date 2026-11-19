import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../integrations/supabase/client';
import { useAuth } from '../contexts/AuthContext';

export interface PresenceUser {
  user_id: string;
  name: string;
  avatar_url: string | null;
  online_at: string;
}

/**
 * Presence on the private per-workspace channel. Realtime Authorization
 * (realtime.messages RLS) only lets members of the workspace join.
 */
export function usePresence(workspaceId: string | null) {
  const { user, profile } = useAuth();
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!workspaceId || !user) {
      setOnline([]);
      return;
    }
    let cancelled = false;

    const channel = supabase.channel(`workspace-presence:${workspaceId}`, {
      config: { presence: { key: user.id }, private: true },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        const state = channel.presenceState<PresenceUser>();
        const users: PresenceUser[] = [];
        for (const key of Object.keys(state)) {
          const entries = state[key] ?? [];
          const first = entries[0];
          if (first) users.push(first);
        }
        setOnline(users);
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          void channel.track({
            user_id: user.id,
            name: profile?.display_name ?? 'Teammate',
            avatar_url: profile?.avatar_url ?? null,
            online_at: new Date().toISOString(),
          } satisfies PresenceUser);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnected(false);
        }
      });

    channelRef.current = channel;
    return () => {
      cancelled = true;
      setConnected(false);
      void channel.untrack().then(() => supabase.removeChannel(channel));
      channelRef.current = null;
    };
  }, [workspaceId, user, profile?.display_name, profile?.avatar_url]);

  return { online, connected };
}
