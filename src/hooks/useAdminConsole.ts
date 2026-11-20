import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import { humanizeError } from '../lib/errors';
import { readString, writeString, removeKey } from '../lib/storage';

/**
 * Admin console data access.
 *
 * The admin key is never stored here — the browser exchanges it once for a
 * session token (see migration 0012), and only that token is kept. The token is
 * random, expires in 8 hours, and can be revoked from the database or from the
 * console itself, so a copied token is worth far less than a copied key.
 *
 * Everything is done through RPCs: the admin tables have RLS on and no grants
 * to `anon` or `authenticated`, so the token is the only way in.
 */

const TOKEN_KEY = 'scratchpad.admin.session';

/** Closed set, so a mistyped RPC name is a compile error rather than a 404. */
type AdminRpc =
  | 'admin_list_users'
  | 'admin_list_workspaces'
  | 'admin_list_audit'
  | 'admin_delete_user'
  | 'admin_set_password'
  | 'admin_delete_workspace'
  | 'admin_revoke_sessions';

/**
 * `admin_login` reports refusals as a `reason` instead of raising, because a
 * raised exception would roll back the failed-attempt row and the brute-force
 * lockout would never count. Translate those codes here, in one testable place.
 */
export function adminLoginMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'locked':
      return 'Too many wrong keys. Wait a few minutes and try again.';
    case 'unconfigured':
      return 'No admin key is configured on the server yet.';
    case 'bad_key':
      return 'That key is not right.';
    default:
      return 'Could not start an admin session.';
  }
}

export interface AdminUser {
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  workspace_count: number;
  item_count: number;
}

export interface AdminWorkspace {
  workspace_id: string;
  name: string;
  type: string;
  owner_email: string;
  member_count: number;
  item_count: number;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  target_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

interface Session {
  token: string;
  expiresAt: string;
}

export function useAdminConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a session across reloads. It still has to be valid server-side —
  // a revoked or expired token fails on the first RPC and drops us to the gate.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    const stored = readString(TOKEN_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Session;
      if (parsed.token && new Date(parsed.expiresAt).getTime() > Date.now()) {
        tokenRef.current = parsed.token;
        setSession(parsed);
      } else {
        removeKey(TOKEN_KEY);
      }
    } catch {
      removeKey(TOKEN_KEY);
    }
  }, []);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    tokenRef.current = null;
    setSession(null);
    setUsers([]);
    setWorkspaces([]);
    setAudit([]);
    removeKey(TOKEN_KEY);
    if (token) {
      // Best effort: the local session is gone either way.
      await supabase.rpc('admin_logout', { p_token: token }).then(
        () => undefined,
        () => undefined,
      );
    }
  }, []);

  /** Wraps an RPC: requires a session, and signs out on a dead token. */
  const call = useCallback(
    async <T,>(fn: AdminRpc, args: Record<string, unknown> = {}): Promise<T> => {
      const token = tokenRef.current;
      if (!token) throw new Error('Not signed in to the admin console.');
      const { data, error: rpcError } = await supabase.rpc(fn, { p_token: token, ...args });
      if (rpcError) {
        const message = humanizeError(rpcError);
        // 28000 = bad/expired session. Anything else is the operation failing.
        if (/session|28000/i.test(message) || /session expired or revoked/i.test(message)) {
          await signOut();
        }
        throw new Error(message);
      }
      return data as T;
    },
    [signOut],
  );

  const signIn = useCallback(async (key: string) => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_login', { p_key: key });
      if (rpcError) throw new Error(humanizeError(rpcError));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.token || !row.expires_at) {
        // admin_login reports refusals as data, not exceptions, so that its
        // failed-attempt counter survives the transaction and can throttle.
        throw new Error(adminLoginMessage(row?.reason));
      }
      const next: Session = { token: row.token, expiresAt: row.expires_at };
      tokenRef.current = next.token;
      setSession(next);
      writeString(TOKEN_KEY, JSON.stringify(next));
    } catch (err) {
      setError(humanizeError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) return;
    setError(null);
    try {
      const [u, w, a] = await Promise.all([
        call<AdminUser[]>('admin_list_users'),
        call<AdminWorkspace[]>('admin_list_workspaces'),
        call<AuditEntry[]>('admin_list_audit', { p_limit: 100 }),
      ]);
      setUsers(u ?? []);
      setWorkspaces(w ?? []);
      setAudit(a ?? []);
    } catch (err) {
      setError(humanizeError(err));
    }
  }, [call]);

  // Load on first sign-in, then keep the online dot honest without a reload.
  // 15 s keeps "online now" believable against a 2-minute presence window.
  useEffect(() => {
    if (!session) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [session, refresh]);

  const deleteUser = useCallback(
    async (userId: string) => {
      await call('admin_delete_user', { p_user_id: userId });
      await refresh();
    },
    [call, refresh],
  );

  const setPassword = useCallback(
    async (userId: string, password: string) => {
      await call('admin_set_password', { p_user_id: userId, p_new_password: password });
      await refresh();
    },
    [call, refresh],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      await call('admin_delete_workspace', { p_workspace_id: workspaceId });
      await refresh();
    },
    [call, refresh],
  );

  const revokeAdminSessions = useCallback(async () => {
    await call<number>('admin_revoke_sessions');
    await signOut();
  }, [call, signOut]);

  return {
    session,
    users,
    workspaces,
    audit,
    loading,
    error,
    signIn,
    signOut,
    refresh,
    deleteUser,
    setPassword,
    deleteWorkspace,
    revokeAdminSessions,
  };
}
