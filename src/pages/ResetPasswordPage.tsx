import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { humanizeError } from '../lib/errors';
import { Icon } from '../components/ui/Icon';

/**
 * Reset / set a new password.
 *
 * Reached two ways:
 *   1. the "Forgot password?" link on the sign-in page (we ask for the email
 *      here, then show "check your inbox");
 *   2. the recovery link Supabase emails out, which redirects back to this app
 *      with the recovery tokens. supabase-js consumes them and fires
 *      PASSWORD_RECOVERY, so the session already exists by the time we render.
 */
export function ResetPasswordPage() {
  const { session, loading, requestPasswordReset, updatePassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [stage, setStage] = useState<'request' | 'sent' | 'set-password'>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A recovery link leaves us with a session; offer the password form directly.
  useEffect(() => {
    if (!loading && session) setStage('set-password');
  }, [loading, session]);

  const sendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setStage('sent');
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== repeat) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      toast.success('Password updated. You are signed in.');
      navigate('/workspace', { replace: true });
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      <div className="pointer-events-none absolute -left-16 top-10 h-40 w-40 rotate-12 rounded-card border-[3px] border-ink bg-lilac/50" />
      <div className="pointer-events-none absolute -right-10 bottom-16 h-32 w-32 -rotate-6 rounded-card border-[3px] border-ink bg-mint/50" />

      <section className="paper relative w-full max-w-md p-6">
        <span className="tape" aria-hidden />
        <h1 className="text-2xl font-black">
          {stage === 'set-password' ? 'Choose a new password' : 'Reset your password'}
        </h1>

        {stage === 'request' ? (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              Enter the email you signed up with and we will send a reset link.
            </p>
            <form onSubmit={sendLink} className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="reset-email">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  data-autofocus
                  placeholder="you@example.com"
                />
              </div>
              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        ) : null}

        {stage === 'sent' ? (
          <div className="mt-3 space-y-3">
            <p className="rounded-xl border-[3px] border-ink bg-mint px-3 py-2 text-sm font-bold" role="status">
              If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your spam folder
              too.
            </p>
            <button
              type="button"
              className="btn w-full"
              onClick={() => {
                setStage('set-password');
              }}
            >
              I already have the link
            </button>
            <button type="button" className="text-sm font-bold underline decoration-2" onClick={() => setStage('request')}>
              Use a different email
            </button>
          </div>
        ) : null}

        {stage === 'set-password' ? (
          <form onSubmit={savePassword} className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                data-autofocus
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="label" htmlFor="repeat-password">
                Repeat password
              </label>
              <input
                id="repeat-password"
                type="password"
                className="input"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}

        <p className="mt-4 flex items-center gap-1.5 text-sm">
          <Icon name="back" size={14} />
          <Link to="/signin" className="font-bold underline decoration-2 underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
