import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../integrations/supabase/client';
import { humanizeError } from '../../lib/errors';
import type { CanvasItem } from '../../types';

/**
 * Trash: what the 90-day sweep moved aside, and when it will be gone.
 *
 * A soft delete with no restore path is just a slower delete, so this panel is
 * the other half of the retention pipeline, not an optional extra.
 */
export function TrashPanel({
  open,
  workspaceId,
  canWrite,
  onClose,
  onRestored,
}: {
  open: boolean;
  workspaceId: string;
  canWrite: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Captured when the list loads, not during render: `Date.now()` in a render
  // path makes the component impure and non-deterministic in tests.
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('list_trashed_items', {
        p_workspace_id: workspaceId,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      setRows((data ?? []) as CanvasItem[]);
      setNow(Date.now());
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const restore = async (item: CanvasItem) => {
    setBusyId(item.id);
    try {
      const { error: rpcError } = await supabase.rpc('restore_canvas_item', { p_item_id: item.id });
      if (rpcError) throw new Error(humanizeError(rpcError));
      setRows((current) => current.filter((row) => row.id !== item.id));
      toast.success('Restored to the canvas.');
      onRestored();
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setBusyId(null);
    }
  };

  const daysLeft = (row: CanvasItem) => {
    if (!row.purge_after) return null;
    const ms = new Date(row.purge_after).getTime() - now;
    return Math.max(0, Math.ceil(ms / 86_400_000));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Trash"
      description="Items older than 90 days move here. Anything left for 100 days is deleted permanently."
      size="md"
      footer={
        <>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {loading ? <p className="text-sm text-ink-soft">Loading…</p> : null}
      {error ? (
        <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing in the trash. Old items land here automatically.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const left = daysLeft(row);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-ink/30 bg-cream px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {row.item_type}
                    {row.content?.text ? ` · ${row.content.text.slice(0, 40)}` : ''}
                  </p>
                  <p className="text-[11px] font-semibold text-ink-soft">
                    {row.deleted_at ? `Trashed ${new Date(row.deleted_at).toLocaleDateString()}` : 'Trashed'}
                    {left !== null ? ` · purged in ${left} day${left === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn min-h-8 px-2 py-0.5 text-xs"
                  disabled={!canWrite || busyId === row.id}
                  onClick={() => void restore(row)}
                >
                  {busyId === row.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!canWrite ? (
        <p className="mt-2 text-xs font-bold text-ink-soft">Only editors and owners can restore items.</p>
      ) : null}
    </Modal>
  );
}
