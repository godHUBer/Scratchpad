import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../integrations/supabase/client';
import { useToast } from '../../contexts/ToastContext';
import { humanizeError } from '../../lib/errors';

interface RetentionPolicy {
  cold_after_days: number;
  trash_after_days: number;
  purge_after_days: number;
  enabled: boolean;
  updated_at: string;
}

/**
 * Controls for the 60 → 90 → 100 day cleanup pipeline.
 *
 * The pipeline ships **paused**. A background job that starts deleting a user's
 * canvases the moment it is installed is not a reasonable default, so this panel
 * is how it gets switched on — by the person whose content it is.
 */
export function RetentionSettings() {
  const toast = useToast();
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('get_retention_policy');
    if (rpcError) {
      setError(humanizeError(rpcError));
      return;
    }
    setPolicy((data as RetentionPolicy | null) ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!policy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('set_retention_enabled', {
        p_enabled: !policy.enabled,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      if (data) setPolicy(data as RetentionPolicy);
      toast.success(!policy.enabled ? 'Auto-cleanup switched on.' : 'Auto-cleanup paused.');
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="paper p-4">
      <h2 className="text-lg font-extrabold">Auto-cleanup</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Content nobody has touched is treated as abandoned in three steps. Deleted items wait in the Trash first, so
        nothing disappears without a way back.
      </p>

      {policy ? (
        <>
          <ol className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2.5 py-1.5">
              <span className="font-bold">Day {policy.cold_after_days}</span>
              <span className="text-xs text-ink-soft">flagged as idle, nothing is deleted</span>
            </li>
            <li className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2.5 py-1.5">
              <span className="font-bold">Day {policy.trash_after_days}</span>
              <span className="text-xs text-ink-soft">moved to Trash, restorable</span>
            </li>
            <li className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2.5 py-1.5">
              <span className="font-bold">Day {policy.purge_after_days}</span>
              <span className="text-xs text-ink-soft">permanently deleted</span>
            </li>
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`chip ${policy.enabled ? 'bg-mint' : 'bg-cream-deep'}`}>
              {policy.enabled ? 'Running nightly' : 'Paused'}
            </span>
            <button type="button" className="btn min-h-8 px-3 py-0.5 text-xs" onClick={() => void toggle()} disabled={busy}>
              {busy ? 'Saving…' : policy.enabled ? 'Pause auto-cleanup' : 'Turn on auto-cleanup'}
            </button>
          </div>
          {!policy.enabled ? (
            <p className="mt-2 text-xs font-bold text-ink-soft">Nothing is being deleted while this is paused.</p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">Loading the cleanup policy…</p>
      )}

      {error ? (
        <p className="mt-2 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
