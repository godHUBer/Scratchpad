import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth, rememberPendingPath, consumePendingPath } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { humanizeError } from '../lib/errors';
import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from '../integrations/supabase/client';
import {
  allProvidersOff,
  oauthCallbackUrl,
  oauthFailureMessage,
  readProviderStates,
  type OAuthProviderName,
  type OAuthProviderState,
} from '../lib/oauthProviders';
import { Spinner } from '../components/ui/Spinner';
import { Icon } from '../components/ui/Icon';

type Mode = 'signin' | 'signup';

export function SignInPage() {
  const { session, loading, signInWithOAuth, signInWithEmail, signUpWithEmail } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState<OAuthProviderName | 'email' | null>(null);
  const [providers, setProviders] = useState<OAuthProviderState[]>(allProvidersOff);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const next = params.get('next');

  // Ask the auth server which social providers are switched on, so we never
  // offer a button that can only end in a provider error page.
  useEffect(() => {
    if (!supabaseConfigured) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings`, {
          headers: { apikey: supabasePublishableKey },
          signal: controller.signal,
        });
        if (!response.ok) return;
        setProviders(readProviderStates(await response.json()));
      } catch {
        // Offline or blocked: leave every provider off and let email carry it.
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (next) rememberPendingPath(next);
  }, [next]);

  if (loading) {
    return (
      <div className="grid min-h-dvh-screen place-items-center p-6">
        <div className="paper px-6 py-5">
          <Spinner label="Checking your session…" />
        </div>
      </div>
    );
  }

  if (session) {
    const pending = next ?? consumePendingPath();
    return <Navigate to={pending && pending.startsWith('/') ? pending : '/workspace'} replace />;
  }

  const handleOAuth = async (provider: OAuthProviderName) => {
    setBusy(provider);
    setError(null);
    try {
      await signInWithOAuth(provider);
      // Redirect happens in the browser; nothing else to do here.
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(oauthFailureMessage(raw) ?? humanizeError(err));
      setBusy(null);
    }
  };

  const handleEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('email');
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const result = await signUpWithEmail(email, password, displayName || email.split('@')[0] || 'Teammate');
        if (result.needsConfirmation) {
          setNotice('Account created. Check your inbox for the confirmation link, then sign in.');
        } else {
          toast.success('Welcome to Scratchpad!');
        }
      } else {
        await signInWithEmail(email, password);
        toast.success('Signed in.');
      }
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative flex min-h-dvh-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      <div className="pointer-events-none absolute -left-16 top-10 h-40 w-40 rotate-12 rounded-card border-[3px] border-ink bg-mint/50" />
      <div className="pointer-events-none absolute -right-10 bottom-16 h-32 w-32 -rotate-6 rounded-card border-[3px] border-ink bg-sky/50" />

      <div className="relative grid w-full max-w-4xl gap-6 md:grid-cols-[1.05fr_1fr]">
        <section className="paper-flat relative flex flex-col justify-center gap-4 p-6 sm:p-8">
          <span className="tape" aria-hidden />
          <h1 className="text-3xl font-black leading-tight sm:text-4xl">
            Scribble it,
            <br />
            save it, share it.
          </h1>
          <p className="text-sm font-semibold text-ink-soft">
            Scratchpad is an infinite whiteboard, shared notebook and bookmark shelf. Drop in text, drawings,
            bookmarks and Google Drive media — then invite your team.
          </p>
          <ul className="grid gap-2 text-sm font-bold">
            <li className="chip justify-start gap-1.5 bg-mustard"><Icon name="brush" size={14} /> Infinite canvas</li>
            <li className="chip justify-start gap-1.5 bg-mint"><Icon name="users" size={14} /> Team roles &amp; invites</li>
            <li className="chip justify-start gap-1.5 bg-sky"><Icon name="link" size={14} /> Drive links, no uploads</li>
          </ul>
        </section>

        <section className="paper p-5 sm:p-6">
          <h2 className="text-xl font-extrabold">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Use a social account for one-tap access, or an email account.</p>

          {!supabaseConfigured ? (
            <div className="mt-4 rounded-xl border-[3px] border-ink bg-coral p-3 text-sm font-bold">
              Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and add your project
              URL and publishable key.
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            {providers.map((provider) => {
              const canUse = provider.enabled && supabaseConfigured && busy === null;
              return (
                <button
                  key={provider.name}
                  type="button"
                  className="btn w-full bg-paper"
                  onClick={() => handleOAuth(provider.name)}
                  disabled={!canUse}
                  // Disabled state still says why, instead of looking broken.
                  title={provider.enabled ? undefined : `${provider.label} sign-in is not configured on the server yet`}
                >
                  {provider.name === 'google' ? <GoogleGlyph /> : <GitHubGlyph />}
                  {provider.enabled
                    ? busy === provider.name
                      ? `Opening ${provider.label}…`
                      : `Continue with ${provider.label}`
                    : `${provider.label} — not set up yet`}
                </button>
              );
            })}
          </div>

          {providers.some((provider) => provider.enabled) ? null : (
            <details className="mt-2 text-xs leading-relaxed text-ink-soft">
              <summary className="cursor-pointer font-bold">Why are the social buttons disabled?</summary>
              <p className="mt-2">
                No social provider is enabled for this project yet, so email sign-in is the way in. To fix it, create an
                OAuth app with the provider and paste its client ID and secret into Supabase under
                <strong> Authentication → Providers</strong>. The authorised redirect URI to register there is:
              </p>
              <code className="mt-1 block break-all rounded-lg border-2 border-ink bg-paper px-2 py-1 font-mono text-[11px]">
                {oauthCallbackUrl(supabaseUrl) || 'https://<project-ref>.supabase.co/auth/v1/callback'}
              </code>
            </details>
          )}

          <div className="my-4 flex items-center gap-3 text-xs font-black uppercase tracking-widest text-ink-soft">
            <span className="h-[3px] flex-1 rounded bg-ink/20" />
            or email
            <span className="h-[3px] flex-1 rounded bg-ink/20" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            {mode === 'signup' ? (
              <div>
                <label className="label" htmlFor="display-name">
                  Display name
                </label>
                <input
                  id="display-name"
                  className="input"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Alex"
                />
              </div>
            ) : null}
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy !== null}>
              {busy === 'email' ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in with email'}
            </button>
          </form>

          {mode === 'signin' ? (
            <p className="mt-2 text-sm">
              <Link
                to="/reset-password"
                className="font-bold underline decoration-2 underline-offset-2"
              >
                Forgot your password?
              </Link>
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="font-bold underline decoration-2 underline-offset-2"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
                setNotice(null);
              }}
            >
              {mode === 'signin' ? 'Create an account' : 'I already have an account'}
            </button>
            <Link
              to="/admin"
              className="text-xs font-bold text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              Admin access
            </Link>
          </div>

          {error ? (
            <p className="mt-3 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-3 rounded-xl border-[3px] border-ink bg-mint px-3 py-2 text-sm font-bold" role="status">
              {notice}
            </p>
          ) : null}

        </section>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.7 1.22 9.19 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.28-3.14.76-4.59l-7.97-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** GitHub's mark, in ink so it matches the rest of the buttons. */
function GitHubGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="#080808"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}
