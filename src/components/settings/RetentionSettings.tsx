import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../integrations/supabase/client';
import { useToast } from '../../contexts/ToastContext';
import { humanizeError } from '../../lib/errors';

export interface RetentionState {
  enabled: boolean;
  cold_after_days: number;
  trash_after_days: number;
  purge_after_days: number;
  can_manage: boolean;
}

/**
 * Controls for the 60 → 90 → 100 day cleanup pipeline, for **one workspace**.
 *
 * Auto-cleanup is a per-workspace opt-in and only that workspace's owner can
 * arm it. Earlier this panel drove a single global row, which meant one
 * signed-in stranger could turn on nightly deletion for every workspace on the
 * deployment — see migration 0013. The workspace id is therefore a required
 * prop, not something this component infers: cleaning up "whatever happens to
 * be active" is exactly the mistake that made the original bug possible.
 *
 * Whether the caller may flip the switch is decided by the server
 * (`can_manage`), not here. A disabled button is presentation, not security.
 */
export function RetentionSettings({ workspaceId, workspaceName }: { workspaceId: string; workspaceName?: string }) {
  const toast = useToast();
  const [state, setState] = useState<RetentionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_workspace_retention', {
      p_workspace_id: workspaceId,
    });
    if (rpcError) {
      setError(humanizeError(rpcError));
      return;
    }
    // A table-returning RPC comes back as an array; a missing row means the
    // workspace vanished between render and request.
    const row = (data as RetentionState[] | null)?.[0];
    setState(row ?? null);
    if (!row) setError('This workspace is not available.');
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!state || !state.can_manage) return;
    setBusy(true);
    setError(null);
    try {
      const next = !state.enabled;
      const { error: rpcError } = await supabase.rpc('set_workspace_retention', {
        p_workspace_id: workspaceId,
        p_enabled: next,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await load();
      toast.success(next ? 'Auto-cleanup switched on.' : 'Auto-cleanup paused.');
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="paper p-4">
      <h2 className="text-lg font-extrabold">
        Auto-cleanup{workspaceName ? <span className="text-ink-soft"> · {workspaceName}</span> : null}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Content nobody has touched is treated as abandoned in three steps. Deleted items wait in the Trash first, so
        nothing disappears without a way back.
      </p>

      {state ? (
        <>
          <ol className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2.5 py-1.5">
              <span className="font-bold">Day {state.cold_after_days}</span>
              <span className="text-xs text-ink-soft">flagged as idle, nothing is deleted</span>
            </li>
            <li className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2.5 py-1.5">
              <span className="font-bold">Day {state.trash_after_days}</span>
              <span className="text-xs text-ink-soft">moved to Trash, restorable</span>
            </li>
            <li className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2.5 py-1.5">
              <span className="font-bold">Day {state.purge_after_days}</span>
              <span className="text-xs text-ink-soft">permanently deleted</span>
            </li>
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`chip ${state.enabled ? 'bg-mint' : 'bg-cream-deep'}`}>
              {state.enabled ? 'Running nightly' : 'Paused'}
            </span>
            {state.can_manage ? (
              <button
                type="button"
                className="btn min-h-8 px-3 py-0.5 text-xs"
                onClick={() => void toggle()}
                disabled={busy}
              >
                {busy ? 'Saving…' : state.enabled ? 'Pause auto-cleanup' : 'Turn on auto-cleanup'}
              </button>
            ) : (
              <span className="text-xs font-bold text-ink-soft">Only the owner can change this.</span>
            )}
          </div>
          {!state.enabled ? (
            <p className="mt-2 text-xs font-bold text-ink-soft">
              Nothing is being deleted from this workspace while this is paused.
            </p>
          ) : (
            <p className="mt-2 text-xs font-bold text-ink-soft">
              Only this workspace is affected. Other workspaces keep their own setting.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">{error ? error : 'Loading the cleanup policy…'}</p>
      )}

      {error && state ? (
        <p className="mt-2 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
