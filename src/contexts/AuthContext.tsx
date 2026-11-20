import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { authRedirectUrl, supabase } from '../integrations/supabase/client';
import type { Profile } from '../types';
import { humanizeError } from '../lib/errors';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Start the OAuth round trip for a provider. */
  signInWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean }>;
  updateProfile: (patch: { display_name?: string; avatar_url?: string | null }) => Promise<void>;
  /** Send the "reset your password" email. */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Apply a new password (used by the recovery link, or by a signed-in user). */
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Where to send the user after the OAuth/email-link round trip. */
const PENDING_PATH_KEY = 'scratchpad.pendingPath';

export function rememberPendingPath(path: string) {
  try {
    sessionStorage.setItem(PENDING_PATH_KEY, path);
  } catch {
    /* storage can be unavailable in private mode; the link still works */
  }
}

export function consumePendingPath(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_PATH_KEY);
    if (value) sessionStorage.removeItem(PENDING_PATH_KEY);
    return value;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileUserId = useRef<string | null>(null);

  const loadProfile = useCallback(async (user: User) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('[scratchpad] profile load failed', error.message);
      return;
    }
    if (data) {
      profileUserId.current = user.id;
      setProfile(data as Profile);
      return;
    }
    // Trigger normally creates the profile; if it is missing (first login race),
    // create it from the auth metadata.
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      (typeof meta['full_name'] === 'string' && meta['full_name']) ||
      (typeof meta['name'] === 'string' && meta['name']) ||
      user.email?.split('@')[0] ||
      'New collaborator';
    const avatar =
      (typeof meta['avatar_url'] === 'string' && meta['avatar_url']) ||
      (typeof meta['picture'] === 'string' && meta['picture']) ||
      null;

    const { data: created, error: createError } = await supabase
      .from('profiles')
      .upsert({ id: user.id, display_name: displayName, avatar_url: avatar }, { onConflict: 'id' })
      .select()
      .maybeSingle();
    if (createError) {
      console.warn('[scratchpad] profile bootstrap failed', createError.message);
      return;
    }
    if (created) {
      profileUserId.current = user.id;
      setProfile(created as Profile);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) void loadProfile(data.session.user);
      setLoading(false);
    });

    // TOKEN_REFRESHED fires roughly hourly AND every time the tab becomes
    // visible again (GoTrue restarts its refresh timer on visibilitychange).
    // `nextSession` is a fresh object on every one of those events, so storing
    // it verbatim churns every consumer that depends on `user`/`session`
    // identity. That is what used to rebuild realtime channels while they were
    // still joining, which throws:
    //   cannot add `presence` callbacks for realtime:... after `subscribe()`
    // Keep the previous object when the identity did not actually change.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession((previous) => {
        if (!nextSession) return null;
        if (
          previous &&
          previous.user.id === nextSession.user.id &&
          previous.access_token === nextSession.access_token
        ) {
          return previous;
        }
        // Same identity, new token: reuse the previous user object so that
        // `user` keeps a stable reference for effects and memo dependencies.
        if (previous && previous.user.id === nextSession.user.id) {
          return { ...nextSession, user: previous.user };
        }
        return nextSession;
      });
      if (nextSession?.user) {
        if (profileUserId.current !== nextSession.user.id) void loadProfile(nextSession.user);
      } else {
        profileUserId.current = null;
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'github') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: authRedirectUrl(),
        // Google: always show the account chooser instead of silently reusing
        // whichever Google session the browser already has.
        queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
      },
    });
    if (error) throw new Error(humanizeError(error));
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(humanizeError(error));
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: displayName.trim() },
        emailRedirectTo: authRedirectUrl(),
      },
    });
    if (error) throw new Error(humanizeError(error));
    return { needsConfirmation: !data.session };
  }, []);

  const updateProfile = useCallback(
    async (patch: { display_name?: string; avatar_url?: string | null }) => {
      if (!session?.user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', session.user.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(humanizeError(error));
      if (data) setProfile(data as Profile);
    },
    [session?.user],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    // The link lands back on the app; GoTrue appends the recovery tokens to the
    // redirect, and supabase-js turns that into PASSWORD_RECOVERY.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl(),
    });
    if (error) throw new Error(humanizeError(error));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(humanizeError(error));
  }, []);

  // "Online" for the admin console = a heartbeat within the last couple of
  // minutes. Realtime presence is not queryable from SQL, so each signed-in
  // client stamps profiles.last_seen_at.
  //
  // This used to `void supabase.rpc(...)`, which threw the result away: if the
  // call failed, nothing anywhere said so and every user looked permanently
  // offline with last_seen_at stuck at "never". The failure is now reported
  // once, and the write is best-effort in SQL so a missing profile row cannot
  // silently swallow it.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let warned = false;
    const beat = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      const { error } = await supabase.rpc('heartbeat');
      if (error && !warned) {
        warned = true;
        console.warn('[scratchpad] presence heartbeat failed', error.message);
      }
    };
    void beat();
    const interval = window.setInterval(() => void beat(), 60_000);
    const onVisible = () => void beat();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [userId]);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user);
  }, [session?.user, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signInWithOAuth,
      signInWithEmail,
      signUpWithEmail,
      updateProfile,
      requestPasswordReset,
      updatePassword,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      loading,
      signInWithOAuth,
      signInWithEmail,
      signUpWithEmail,
      updateProfile,
      requestPasswordReset,
      updatePassword,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
