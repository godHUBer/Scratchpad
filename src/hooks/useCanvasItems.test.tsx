// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { useCanvasItems } from './useCanvasItems';

/**
 * Regression cover for review item #4: silent 1-hop write conflicts.
 *
 * The server used to return the bare row on both paths, so the client guessed:
 *
 *     if (row.version > current.version + 1) setConflicts(n => n + 1)
 *
 * With a local version of 5, a clean write returns 6 and *one* interfering
 * write also returns 6. The most common collision was therefore invisible: the
 * user's edit was discarded, someone else's row adopted, and the sync pill
 * reported a clean save.
 *
 * Migration 0014 makes both RPCs return `{ item, expected_version, conflict }`.
 * These tests drive the real hook against a fake server that reproduces the
 * arithmetic exactly, and assert that the client believes the flag rather than
 * recomputing it. The key test is the one where the version *looks* fine and
 * the flag says otherwise -- that case is the entire bug.
 */

type RpcResult = { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();
/** Rows the initial table read returns. Set per-test where it matters. */
const tableRows: { current: Record<string, unknown[]> } = { current: {} };

vi.mock('../integrations/supabase/client', () => {
  // The real module exports a channel-lifecycle trio; the hook only needs them
  // to be inert. Reimplementing their teardown bookkeeping here would test the
  // helper rather than the hook.
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: () => Promise.resolve('ok'),
    topic: 'canvas:ws-1',
  };
  return {
    supabase: {
      // The hook loads through PostgREST table reads, not an RPC, so the fake
      // has to answer per table. `order` is chainable and returns the promise.
      from: (table: string) => ({
        select: () => {
          // `bookmarks`/`media_assets` are awaited straight off `.eq()`, while
          // `canvas_items` is chained through `.order()`. Both must resolve.
          const rows = () => Promise.resolve({ data: tableRows.current[table] ?? [], error: null });
          const eq = () => {
            const p = rows() as Promise<{ data: unknown[]; error: null }> & { order?: () => Promise<unknown> };
            p.order = rows;
            return p;
          };
          return { eq, order: rows };
        },
      }),
      rpc: (fn: string, args: unknown) => rpc(fn, args),
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
    },
    freshChannel: () => Promise.resolve(channel),
    isChannelRetired: () => false,
    teardownChannel: () => Promise.resolve(),
    supabaseConfigured: true,
    supabaseUrl: 'https://proj.supabase.co',
    supabasePublishableKey: 'publishable-key',
  };
});

import { renderHook } from '@testing-library/react';

const ITEM_VERSION = 5;

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    workspace_id: 'ws-1',
    item_type: 'note',
    position_x: 10,
    position_y: 20,
    width: 240,
    height: 160,
    content: { text: 'hello' },
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: ITEM_VERSION,
    ...overrides,
  };
}

/** Routes the list query through `rpc` so the hook starts with one item. */
beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: null, error: null }));
  tableRows.current = { canvas_items: [serverRow()], bookmarks: [], media_assets: [] };
});

afterEach(cleanup);

async function mountHook() {
  const view = renderHook(() => useCanvasItems({ workspaceId: 'ws-1', canWrite: true }));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

/** A clean, non-conflicting server response for whichever write RPC is called. */
function cleanWrite() {
  rpc.mockImplementation(async (fn: string, args: unknown) => {
    if (fn === 'update_canvas_item') {
      return {
        data: [{ item: serverRow({ version: ITEM_VERSION + 1 }), expected_version: ITEM_VERSION, conflict: false }],
        error: null,
      };
    }
    if (fn === 'move_canvas_items') {
      const moves = (args as { p_moves: Array<{ id: string; x: number; y: number; version: number }> }).p_moves;
      return {
        data: moves.map((m) => ({
          item: serverRow({ id: m.id, position_x: m.x, position_y: m.y, version: m.version + 1 }),
          expected_version: m.version,
          conflict: false,
        })),
        error: null,
      };
    }
    return { data: null, error: null };
  });
}

describe('useCanvasItems conflict reporting', () => {
  it('reports a conflict when the server flags one, even though the version looks like a clean write', async () => {
    const view = await mountHook();

    // This is the exact shape 0010 produced for a 1-hop collision: the row is
    // at expected + 1, indistinguishable from our own successful write.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'update_canvas_item') {
        return {
          data: [
            {
              item: serverRow({ version: ITEM_VERSION + 1, content: { text: 'theirs' } }),
              expected_version: ITEM_VERSION,
              conflict: true,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    await view.result.current.patchItem('item-1', { content: { text: 'mine' } });

    await waitFor(() => expect(view.result.current.conflicts).toBe(1));
    // ...and the other editor's row was adopted, because ours never landed.
    expect(view.result.current.items[0]?.content).toEqual({ text: 'theirs' });
  });

  it('does not invent a conflict on a genuine clean write', async () => {
    const view = await mountHook();

    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'update_canvas_item') {
        return {
          data: [
            {
              item: serverRow({ version: ITEM_VERSION + 1, content: { text: 'mine' } }),
              expected_version: ITEM_VERSION,
              conflict: false,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    await view.result.current.patchItem('item-1', { content: { text: 'mine' } });

    await waitFor(() => expect(view.result.current.items[0]?.content).toEqual({ text: 'mine' }));
    expect(view.result.current.conflicts).toBe(0);
  });

  it('sends the version it drew from, not a fresh read', async () => {
    const view = await mountHook();
    cleanWrite();

    await view.result.current.patchItem('item-1', { position_x: 99 });

    const call = rpc.mock.calls.find(([fn]) => fn === 'update_canvas_item');
    expect(call).toBeTruthy();
    expect((call![1] as { p_expected_version: number }).p_expected_version).toBe(ITEM_VERSION);
  });

  it('sends a version with every move so a stale drag cannot clobber silently', async () => {
    const view = await mountHook();
    cleanWrite();

    await view.result.current.moveItems([{ id: 'item-1', x: 50, y: 60 }]);

    const call = rpc.mock.calls.find(([fn]) => fn === 'move_canvas_items');
    expect(call).toBeTruthy();
    const moves = (call![1] as { p_moves: Array<{ id: string; version?: number }> }).p_moves;
    expect(moves).toHaveLength(1);
    // Before 0014 this field did not exist at all, which is why a stale drag
    // overwrote the other editor and could never be reported.
    expect(moves[0]?.version).toBe(ITEM_VERSION);
  });

  it('counts every stale row when a multi-item drag is rejected', async () => {
    const view = await mountHook();

    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'move_canvas_items') {
        // All-or-nothing rejection: both rows come back unchanged and flagged.
        return {
          data: [
            { item: serverRow({ id: 'item-1', version: 9 }), expected_version: 5, conflict: true },
            { item: serverRow({ id: 'item-2', version: 4 }), expected_version: 1, conflict: true },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    await view.result.current.moveItems([
      { id: 'item-1', x: 1, y: 1 },
      { id: 'item-2', x: 2, y: 2 },
    ]);

    await waitFor(() => expect(view.result.current.conflicts).toBe(2));
  });

  it('restores the pre-optimistic row when the write is rejected outright', async () => {
    const view = await mountHook();

    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'update_canvas_item') return { data: null, error: { message: 'row changed' } };
      return { data: null, error: null };
    });

    await expect(view.result.current.patchItem('item-1', { position_x: 999 })).rejects.toThrow();
    // The optimistic patch must not survive a server rejection.
    await waitFor(() => expect(view.result.current.items[0]?.position_x).toBe(10));
    expect(view.result.current.conflicts).toBe(0);
  });
});
