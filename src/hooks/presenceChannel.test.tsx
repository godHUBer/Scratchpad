// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { usePresence } from './usePresence';

/**
 * Regression test for the reported production error:
 *
 *   cannot add `presence` callbacks for realtime:workspace-presence:<id>
 *   after `subscribe()`   … "whenever I look away from the tab"
 *
 * Looking away and back makes GoTrue refresh the access token, which fires
 * TOKEN_REFRESHED. That used to give `useAuth().user` a new object identity,
 * re-running the presence effect, which called `supabase.channel(topic)` while
 * the previous channel for that topic was still joining.
 *
 * `usePresence` is the real hook. Only its two dependencies (the Supabase client
 * and the auth context) are replaced, with a fake channel that enforces the same
 * rules as the real client — including returning the *existing* channel for a
 * topic that has not finished unsubscribing.
 */

interface FakeChannel {
  topic: string;
  state: 'closed' | 'joining' | 'joined';
  subscribeCount: number;
  on: (type: string) => FakeChannel;
  subscribe: () => FakeChannel;
  unsubscribe: () => Promise<'ok'>;
  presenceState: () => Record<string, unknown>;
  track: () => Promise<'ok'>;
  untrack: () => Promise<'ok'>;
}

type Harness = {
  channels: FakeChannel[];
  removeChannelCalls: number;
  authState: { userId: string | null; displayName: string; avatarUrl: string | null };
};

// vi.mock factories are hoisted above imports, so everything they reference must
// be created here rather than with a normal top-level const.
const harness = vi.hoisted<Harness>(() => ({
  channels: [],
  removeChannelCalls: 0,
  authState: { userId: 'user-1', displayName: 'Ada', avatarUrl: null },
}));

vi.mock('../integrations/supabase/client', () => {
  const h = harness;

  function makeChannel(topic: string): FakeChannel {
    const channel: FakeChannel = {
      topic,
      state: 'closed',
      subscribeCount: 0,
      on(type: string) {
        // the real client's guard, reproduced faithfully
        if ((channel.state === 'joining' || channel.state === 'joined') && type === 'presence') {
          throw new Error(`cannot add \`${type}\` callbacks for ${topic} after \`subscribe()\`.`);
        }
        return channel;
      },
      subscribe() {
        channel.state = 'joining';
        channel.subscribeCount += 1;
        return channel;
      },
      async unsubscribe() {
        channel.state = 'closed';
        return 'ok';
      },
      presenceState: () => ({}),
      track: async () => 'ok',
      untrack: async () => 'ok',
    };
    return channel;
  }

  const supabase = {
    channel(topicWithPrefix: string, _options?: unknown) {
      const topic = `realtime:${topicWithPrefix}`;
      const existing = h.channels.find((c) => c.topic === topic);
      if (existing) return existing; // same reuse behaviour as RealtimeClient.channel()
      const created = makeChannel(topic);
      h.channels.push(created);
      return created;
    },
    async removeChannel(channel: FakeChannel) {
      h.removeChannelCalls += 1;
      await Promise.resolve(); // asynchronous, like the real one
      await channel.unsubscribe();
      const index = h.channels.indexOf(channel);
      if (index >= 0) h.channels.splice(index, 1);
      return 'ok';
    },
  };

  // the real module dedupes per topic; mirror that contract
  const inFlight = new Map<string, Promise<unknown>>();

  return {
    supabase,
    freshChannel: async (topic: string, options?: unknown) => {
      const pending = inFlight.get(topic);
      if (pending) await pending.catch(() => undefined);
      return supabase.channel(topic, options);
    },
    teardownChannel: (channel: FakeChannel) => {
      const promise = supabase.removeChannel(channel);
      inFlight.set(channel.topic, promise);
      void promise.finally(() => {
        if (inFlight.get(channel.topic) === promise) inFlight.delete(channel.topic);
      });
      return promise;
    },
    supabaseConfigured: true,
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
  };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => {
    const { userId, displayName, avatarUrl } = harness.authState;
    return {
      user: userId ? { id: userId } : null,
      profile: userId ? { id: userId, display_name: displayName, avatar_url: avatarUrl } : null,
    };
  },
}));

const channels = harness.channels;
const authState = harness.authState;

function Probe({ workspaceId }: { workspaceId: string }) {
  const { online, connected } = usePresence(workspaceId);
  return createElement('div', {
    'data-testid': 'probe',
    'data-online': online.length,
    'data-connected': String(connected),
  });
}

function renderProbe(workspaceId: string) {
  const tree = (id: string): ReactNode => createElement(Probe, { workspaceId: id });
  const { rerender } = render(tree(workspaceId));
  return { rerender: (id: string) => rerender(tree(id)) };
}

beforeEach(() => {
  channels.length = 0;
  harness.removeChannelCalls = 0;
  authState.userId = 'user-1';
  authState.displayName = 'Ada';
  authState.avatarUrl = null;
});

afterEach(() => {
  cleanup();
});

describe('usePresence channel lifecycle', () => {
  it('subscribes exactly once on mount and does not throw', async () => {
    renderProbe('ws-1');
    await waitFor(() => expect(channels).toHaveLength(1));
    await waitFor(() => expect(channels[0]!.subscribeCount).toBe(1));
    expect(channels[0]!.topic).toBe('realtime:workspace-presence:ws-1');
  });

  it('reuses one channel while the workspace is unchanged', async () => {
    const { rerender } = renderProbe('ws-1');
    await waitFor(() => expect(channels).toHaveLength(1));
    rerender('ws-1');
    rerender('ws-1');
    await waitFor(() => expect(channels).toHaveLength(1));
    expect(channels[0]!.subscribeCount).toBe(1);
  });

  it('survives unmount + immediate remount on the same topic (no subscribe() race)', async () => {
    renderProbe('ws-1');
    await waitFor(() => expect(channels).toHaveLength(1));

    // this is the shape of the bug: the next mount asks for the same topic
    // before the previous channel has finished leaving
    cleanup();
    expect(() => renderProbe('ws-1')).not.toThrow();

    await waitFor(() => expect(channels).toHaveLength(1));
    expect(harness.removeChannelCalls).toBeGreaterThanOrEqual(1);
  });

  it('never registers a presence listener on a joining channel', async () => {
    // if the hook built the channel synchronously, `.on('presence')` would land
    // on a joining channel and throw — which is exactly the production error
    expect(() => renderProbe('ws-1')).not.toThrow();
    await waitFor(() => expect(channels).toHaveLength(1));
    await waitFor(() => expect(channels[0]!.state).toBe('joining'));
    expect(channels[0]!.subscribeCount).toBe(1);
  });
});

describe('profile changes do not rebuild the channel', () => {
  it('keeps the same channel when the display name changes', async () => {
    const { rerender } = renderProbe('ws-1');
    await waitFor(() => expect(channels).toHaveLength(1));
    const first = channels[0]!;

    authState.displayName = 'Ada Lovelace';
    rerender('ws-1');

    await waitFor(() => expect(channels).toHaveLength(1));
    expect(channels[0]).toBe(first);
    expect(first.subscribeCount).toBe(1);
    expect(harness.removeChannelCalls).toBe(0);
  });

  it('keeps the same channel when the avatar changes', async () => {
    const { rerender } = renderProbe('ws-1');
    await waitFor(() => expect(channels).toHaveLength(1));
    const first = channels[0]!;

    authState.avatarUrl = 'https://example.com/a.png';
    rerender('ws-1');

    await waitFor(() => expect(channels).toHaveLength(1));
    expect(channels[0]).toBe(first);
    expect(first.subscribeCount).toBe(1);
  });
});
