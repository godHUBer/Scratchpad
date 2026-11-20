// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Regression cover for "fix google login and also add github login".
 *
 * The old page rendered a Google button unconditionally. The project had no
 * Google provider configured, so pressing it bounced the user to a bare
 * provider error page. The page now asks /auth/v1/settings first.
 */
const signInWithOAuth = vi.fn();
const settings = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    loading: false,
    signInWithOAuth,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
  }),
  rememberPendingPath: vi.fn(),
  consumePendingPath: vi.fn(() => null),
}));

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../integrations/supabase/client', () => ({
  supabaseConfigured: true,
  supabaseUrl: 'https://proj.supabase.co',
  supabasePublishableKey: 'publishable-key',
}));

import { SignInPage } from './SignInPage';

function answerWith(external: Record<string, boolean>) {
  settings.mockResolvedValue({ ok: true, json: async () => ({ external }) } as Response);
}

beforeEach(() => {
  signInWithOAuth.mockReset();
  settings.mockReset();
  vi.stubGlobal('fetch', settings);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <SignInPage />
    </MemoryRouter>,
  );

describe('SignInPage social buttons', () => {
  it('asks the auth server which providers are enabled', async () => {
    answerWith({ google: true, github: true });
    renderPage();
    await waitFor(() => expect(settings).toHaveBeenCalled());
    expect(String(settings.mock.calls[0]?.[0])).toBe('https://proj.supabase.co/auth/v1/settings');
  });

  it('enables both buttons when both providers are configured', async () => {
    answerWith({ google: true, github: true });
    renderPage();
    const google = (await screen.findByRole('button', { name: /continue with google/i })) as HTMLButtonElement;
    const github = screen.getByRole('button', { name: /continue with github/i }) as HTMLButtonElement;
    expect(google.disabled).toBe(false);
    expect(github.disabled).toBe(false);
  });

  it('adds a working GitHub button that starts the github provider', async () => {
    answerWith({ google: false, github: true });
    renderPage();
    const github = (await screen.findByRole('button', { name: /continue with github/i })) as HTMLButtonElement;
    github.click();
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith('github'));
  });

  it('disables a provider the server has not enabled, instead of failing later', async () => {
    answerWith({ google: false, github: false });
    renderPage();
    const buttons = (await screen.findAllByRole('button', { name: /not set up yet/i })) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(buttons.map((b) => b.textContent).join(' ')).toMatch(/google.*github/is);
  });

  it('keeps everything disabled and explains why when the settings call fails', async () => {
    settings.mockRejectedValue(new Error('blocked'));
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: /not set up yet/i });
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('shows the callback URL the operator must register', async () => {
    answerWith({ google: false, github: false });
    renderPage();
    await screen.findAllByRole('button', { name: /not set up yet/i });
    expect(screen.getByText('https://proj.supabase.co/auth/v1/callback')).toBeTruthy();
  });
});
