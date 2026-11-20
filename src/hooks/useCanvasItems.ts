import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { freshChannel, supabase, teardownChannel } from '../integrations/supabase/client';
import { humanizeError } from '../lib/errors';
import type { Bookmark, CanvasContent, CanvasItem, CanvasItemType, MediaAsset } from '../types';

export type SyncState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export interface NewCanvasItem {
  item_type: CanvasItemType;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  content?: CanvasContent;
  bookmark_id?: string | null;
  media_asset_id?: string | null;
}

interface UseCanvasItemsOptions {
  workspaceId: string | null;
  canWrite: boolean;
  onRemoteChange?: (item: CanvasItem | null, kind: 'insert' | 'update' | 'delete') => void;
}

function asCanvasItem(row: Record<string, unknown>): CanvasItem {
  return {
    ...(row as unknown as CanvasItem),
    content: (row['content'] ?? {}) as CanvasContent,
  };
}

/**
 * Owns the canvas item list for one workspace:
 *  - loads rows, subscribes to realtime changes (RLS-filtered by the server)
 *  - every mutation goes through an RPC with an expected version
 *  - a stale write returns the newer row, which we adopt and report as conflict
 */
export function useCanvasItems({ workspaceId, canWrite, onRemoteChange }: UseCanvasItemsOptions) {
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark>>({});
  const [media, setMedia] = useState<Record<string, MediaAsset>>({});
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const itemsRef = useRef<CanvasItem[]>([]);
  itemsRef.current = items;
  const pendingWrites = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const remoteCallback = useRef(onRemoteChange);
  remoteCallback.current = onRemoteChange;

  const load = useCallback(async () => {
    if (!workspaceId) {
      setItems([]);
      setBookmarks({});
      setMedia({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [itemRes, bookmarkRes, mediaRes] = await Promise.all([
        supabase.from('canvas_items').select('*').eq('workspace_id', workspaceId).order('created_at'),
        supabase.from('bookmarks').select('*').eq('workspace_id', workspaceId),
        supabase.from('media_assets').select('*').eq('workspace_id', workspaceId),
      ]);
      if (itemRes.error) throw new Error(humanizeError(itemRes.error));
      if (bookmarkRes.error) throw new Error(humanizeError(bookmarkRes.error));
      if (mediaRes.error) throw new Error(humanizeError(mediaRes.error));

      setItems((itemRes.data ?? []).map((row) => asCanvasItem(row as Record<string, unknown>)));
      setBookmarks(Object.fromEntries((bookmarkRes.data ?? []).map((b) => [b.id, b as Bookmark])));
      setMedia(Object.fromEntries((mediaRes.data ?? []).map((m) => [m.id, m as MediaAsset])));
      setSync('saved');
      setLastSavedAt(new Date());
    } catch (err) {
      setError(humanizeError(err));
      setSync('error');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------------------------------------------------------------- realtime
  useEffect(() => {
    if (!workspaceId) return;
    const topic = `workspace-data:${workspaceId}`;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    void freshChannel(topic).then((created) => {
      if (cancelled) {
        void teardownChannel(created);
        return;
      }
      channel = created;
      created
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'canvas_items', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<CanvasItem>;
            if (!old.id) return;
            setItems((current) => current.filter((item) => item.id !== old.id));
            remoteCallback.current?.(null, 'delete');
            return;
          }
          const row = asCanvasItem(payload.new as Record<string, unknown>);
          setItems((current) => {
            const existing = current.find((item) => item.id === row.id);
            if (!existing) {
              if (payload.eventType === 'INSERT') {
                remoteCallback.current?.(row, 'insert');
                return [...current, row];
              }
              return current;
            }
            // Ignore echoes of our own write and never move backwards in version.
            if (row.version <= existing.version) return current;
            remoteCallback.current?.(row, 'update');
            return current.map((item) => (item.id === row.id ? row : item));
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookmarks', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<Bookmark>;
            if (!old.id) return;
            setBookmarks((current) => {
              const next = { ...current };
              delete next[old.id!];
              return next;
            });
            return;
          }
          const row = payload.new as Bookmark;
          setBookmarks((current) => ({ ...current, [row.id]: row }));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'media_assets', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<MediaAsset>;
            if (!old.id) return;
            setMedia((current) => {
              const next = { ...current };
              delete next[old.id!];
              return next;
            });
            return;
          }
          const row = payload.new as MediaAsset;
          setMedia((current) => ({ ...current, [row.id]: row }));
        },
      )
      .subscribe();

      channelRef.current = created;
    });

    const onOnline = () => setSync((s) => (s === 'offline' ? 'idle' : s));
    const onOffline = () => setSync('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) setSync('offline');

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      channelRef.current = null;
      if (channel) void teardownChannel(channel);
    };
  }, [workspaceId]);

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    pendingWrites.current += 1;
    setSync('saving');
    try {
      const result = await work();
      setLastSavedAt(new Date());
      return result;
    } catch (err) {
      setSync('error');
      throw err;
    } finally {
      pendingWrites.current = Math.max(0, pendingWrites.current - 1);
      if (pendingWrites.current === 0) {
        setSync(navigator.onLine ? 'saved' : 'offline');
      }
    }
  }, []);

  const createItem = useCallback(
    async (input: NewCanvasItem): Promise<CanvasItem> => {
      if (!workspaceId) throw new Error('No workspace selected.');
      if (!canWrite) throw new Error('Viewers cannot modify this workspace.');
      return track(async () => {
        const { data, error: rpcError } = await supabase.rpc('create_canvas_item', {
          p_workspace_id: workspaceId,
          p_item_type: input.item_type,
          p_position_x: Math.round(input.position_x),
          p_position_y: Math.round(input.position_y),
          p_width: Math.max(20, Math.round(input.width)),
          p_height: Math.max(20, Math.round(input.height)),
          p_content: (input.content ?? {}) as never,
          p_bookmark_id: input.bookmark_id ?? null,
          p_media_asset_id: input.media_asset_id ?? null,
        });
        if (rpcError) throw new Error(humanizeError(rpcError));
        const row = asCanvasItem(data as Record<string, unknown>);
        setItems((current) => (current.some((i) => i.id === row.id) ? current : [...current, row]));
        return row;
      });
    },
    [workspaceId, canWrite, track],
  );

  const patchItem = useCallback(
    async (
      id: string,
      patch: Partial<Pick<CanvasItem, 'position_x' | 'position_y' | 'width' | 'height' | 'content'>>,
    ): Promise<CanvasItem> => {
      if (!canWrite) throw new Error('Viewers cannot modify this workspace.');
      const current = itemsRef.current.find((item) => item.id === id);
      if (!current) throw new Error('That item no longer exists.');

      // optimistic local update so dragging feels instant
      setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));

      return track(async () => {
        const { data, error: rpcError } = await supabase.rpc('update_canvas_item', {
          p_item_id: id,
          p_expected_version: current.version,
          p_patch: patch as never,
        });
        if (rpcError) throw new Error(humanizeError(rpcError));
        const row = asCanvasItem(data as Record<string, unknown>);
        if (row.version > current.version + 1) {
          // someone else wrote in between: adopt their row instead of clobbering
          setConflicts((n) => n + 1);
        }
        setItems((list) => list.map((item) => (item.id === id ? row : item)));
        return row;
      });
    },
    [canWrite, track],
  );

  const moveItems = useCallback(
    async (
      moves: Array<{ id: string; x: number; y: number; w?: number; h?: number }>,
    ): Promise<void> => {
      if (!canWrite || moves.length === 0) return;
      setItems((list) =>
        list.map((item) => {
          const move = moves.find((m) => m.id === item.id);
          if (!move) return item;
          return {
            ...item,
            position_x: move.x,
            position_y: move.y,
            width: move.w ?? item.width,
            height: move.h ?? item.height,
          };
        }),
      );
      await track(async () => {
        const { data, error: rpcError } = await supabase.rpc('move_canvas_items', {
          p_item_ids: moves.map((m) => m.id),
          p_moves: moves.map((m) => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), w: m.w, h: m.h })) as never,
        });
        if (rpcError) throw new Error(humanizeError(rpcError));
        const rows = (data ?? []).map((row) => asCanvasItem(row as Record<string, unknown>));
        setItems((list) =>
          list.map((item) => rows.find((row) => row.id === item.id) ?? item),
        );
      });
    },
    [canWrite, track],
  );

  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      if (!canWrite) throw new Error('Viewers cannot modify this workspace.');
      setItems((list) => list.filter((item) => item.id !== id));
      await track(async () => {
        const { error: rpcError } = await supabase.rpc('delete_canvas_item', { p_item_id: id });
        if (rpcError) throw new Error(humanizeError(rpcError));
      });
    },
    [canWrite, track],
  );

  const duplicateItem = useCallback(
    async (id: string): Promise<CanvasItem> => {
      if (!canWrite) throw new Error('Viewers cannot modify this workspace.');
      return track(async () => {
        const { data, error: rpcError } = await supabase.rpc('duplicate_canvas_item', {
          p_item_id: id,
          p_offset: 28,
        });
        if (rpcError) throw new Error(humanizeError(rpcError));
        const row = asCanvasItem(data as Record<string, unknown>);
        setItems((current) => [...current, row]);
        return row;
      });
    },
    [canWrite, track],
  );

  const setLayer = useCallback(
    async (id: string, direction: 'front' | 'back' | 'forward' | 'backward'): Promise<void> => {
      if (!canWrite) return;
      await track(async () => {
        const { error: rpcError } = await supabase.rpc('set_canvas_item_layer', {
          p_item_id: id,
          p_direction: direction,
        });
        if (rpcError) throw new Error(humanizeError(rpcError));
      });
      await load();
    },
    [canWrite, track, load],
  );

  const refreshBookmarks = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase.from('bookmarks').select('*').eq('workspace_id', workspaceId);
    if (data) setBookmarks(Object.fromEntries((data as Bookmark[]).map((b) => [b.id, b])));
  }, [workspaceId]);

  const refreshMedia = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase.from('media_assets').select('*').eq('workspace_id', workspaceId);
    if (data) setMedia(Object.fromEntries((data as MediaAsset[]).map((m) => [m.id, m])));
  }, [workspaceId]);

  const bookmarkList = useMemo(() => Object.values(bookmarks), [bookmarks]);
  const mediaList = useMemo(() => Object.values(media), [media]);

  return {
    items,
    bookmarkList,
    mediaList,
    bookmarks,
    media,
    loading,
    sync,
    error,
    conflicts,
    lastSavedAt,
    reload: load,
    createItem,
    patchItem,
    moveItems,
    deleteItem,
    duplicateItem,
    setLayer,
    refreshBookmarks,
    refreshMedia,
    setItems,
  };
}
