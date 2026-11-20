import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// A WebSocket that never becomes ready, so channels stay in `joining` —
// exactly the state the page was in when the user looked away and back.
class NeverReadySocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = NeverReadySocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  send() {}
  close() {}
}

const makeClient = () =>
  createClient('https://example.supabase.co', 'sb_publishable_test', {
    realtime: { transport: NeverReadySocket as never, params: {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });

const PRESENCE_TOPIC = 'realtime:workspace-presence:ws-1';

describe('realtime channel reuse (the reported bug)', () => {
  it('throws when a presence listener is added to a still-joining channel', () => {
    const supabase = makeClient();
    const channel = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    channel.on('presence', { event: 'sync' }, () => {});
    channel.subscribe();

    // supabase.channel() returns the SAME registered channel for this topic,
    // so a second subscription attempt adds a presence handler to a channel
    // that is already joining -> the error the user saw.
    const again = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    expect(again.topic).toBe(PRESENCE_TOPIC);
    expect(() => again.on('presence', { event: 'sync' }, () => {})).toThrow(
      /cannot add `presence` callbacks .* after `subscribe\(\)`/,
    );
  });

  it('is safe once the previous channel has finished tearing down', async () => {
    const supabase = makeClient();
    const first = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    first.on('presence', { event: 'sync' }, () => {});
    first.subscribe();

    // this is what teardownChannel() + freshChannel() guarantee: we await the
    // teardown before asking for the topic again
    await supabase.removeChannel(first);

    const second = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    expect(second.topic).toBe(PRESENCE_TOPIC);
    expect(() => second.on('presence', { event: 'sync' }, () => {})).not.toThrow();
    second.unsubscribe();
  });

  it('proves the un-awaited teardown path is the bug: removeChannel is async', async () => {
    const supabase = makeClient();
    const first = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    first.on('presence', { event: 'sync' }, () => {});
    first.subscribe();

    // `void supabase.removeChannel(ch)` — fire and forget, as the old cleanup did
    const teardown = supabase.removeChannel(first);
    let settled = false;
    void teardown.then(() => { settled = true; });

    // removeChannel() is asynchronous. Right after firing it the channel is
    // still registered, so asking for the same topic hands back the dying
    // channel — the window that produced the reported error.
    expect(settled).toBe(false);
    // grab the same topic synchronously — before the microtask that unregisters it
    const raced = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    expect(raced.topic).toBe(PRESENCE_TOPIC);

    // and it only becomes safe once the teardown has actually finished
    await teardown;
    const after = supabase.channel('workspace-presence:ws-1', {
      config: { presence: { key: 'user-1' }, private: true },
    });
    expect(after).not.toBe(first);
    expect(() => after.on('presence', { event: 'sync' }, () => {})).not.toThrow();
    after.unsubscribe();
  });
});
