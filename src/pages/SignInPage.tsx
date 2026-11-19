import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth, rememberPendingPath, consumePendingPath } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { humanizeError } from '../lib/errors';
import { supabaseConfigured } from '../integrations/supabase/client';
import { Spinner } from '../components/ui/Spinner';

type Mode = 'signin' | 'signup';

export function SignInPage() {
  const { session, loading, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const next = params.get('next');

  useEffect(() => {
    if (next) rememberPendingPath(next);
  }, [next]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
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

  const handleGoogle = async () => {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle();
      // Redirect happens in the browser; nothing else to do here.
    } catch (err) {
      setError(humanizeError(err));
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
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
            <li className="chip justify-start bg-mustard">🖍️ Infinite canvas</li>
            <li className="chip justify-start bg-mint">👥 Team roles &amp; invites</li>
            <li className="chip justify-start bg-sky">🔗 Drive links, no uploads</li>
          </ul>
        </section>

        <section className="paper p-5 sm:p-6">
          <h2 className="text-xl font-extrabold">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Use Google for one-tap access, or an email account.</p>

          {!supabaseConfigured ? (
            <div className="mt-4 rounded-xl border-[3px] border-ink bg-coral p-3 text-sm font-bold">
              Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and add your project
              URL and publishable key.
            </div>
          ) : null}

          <button
            type="button"
            className="btn mt-4 w-full bg-paper"
            onClick={handleGoogle}
            disabled={busy !== null || !supabaseConfigured}
          >
            <GoogleGlyph />
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>

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

          <p className="mt-4 text-xs leading-relaxed text-ink-soft">
            Google sign-in needs a Supabase Google provider configured with your own OAuth client. Setup steps are in
            the README — until then, email sign-in works out of the box.
          </p>
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
