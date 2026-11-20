// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The admin key gate lives in the browser, but the check does not: the page
 * only ever hands the key to the `admin_login` RPC. These tests pin the two
 * things that are easy to regress — the page renders a key field and nothing
 * privileged before it, and a refused key shows the server's reason instead of
 * dropping the operator into the console.
 */
const signIn = vi.fn();

vi.mock('../hooks/useAdminConsole', () => ({
  adminLoginMessage: () => 'That key is not right.',
  useAdminConsole: () => ({
    session: null,
    users: [],
    workspaces: [],
    audit: [],
    error: 'That key is not right.',
    loading: false,
    signIn,
    signOut: vi.fn(),
    refresh: vi.fn(),
    deleteUser: vi.fn(),
    setPassword: vi.fn(),
    deleteWorkspace: vi.fn(),
    revokeSessions: vi.fn(),
  }),
}));

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { AdminPage } from './AdminPage';

afterEach(() => cleanup());

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

describe('AdminPage gate', () => {
  it('asks for the key and sends it to the server', async () => {
    signIn.mockResolvedValue(undefined);
    renderPage();

    const field = screen.getByLabelText(/admin key/i);
    fireEvent.change(field, { target: { value: 'trying-a-key' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock admin console/i }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('trying-a-key'));
  });

  it('will not submit an empty key', () => {
    signIn.mockClear();
    renderPage();
    const button = screen.getByRole('button', { name: /unlock admin console/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the refusal and stays on the gate', () => {
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/not right/i);
    expect(screen.queryByText(/admin console$/i)).not.toBeNull();
    expect(screen.queryByText(/^Users$/)).toBeNull();
  });

  it('never renders a key input of type text', () => {
    renderPage();
    expect((screen.getByLabelText(/admin key/i) as HTMLInputElement).type).toBe('password');
  });
});
