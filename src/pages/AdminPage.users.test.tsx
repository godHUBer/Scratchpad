// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The console must let an operator find one person among many, and must not
 * show "never" for someone who signed in and then closed the tab.
 */
const users = [
  {
    user_id: '1',
    email: 'zara@x.com',
    display_name: 'Zara',
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-03-01T00:00:00Z',
    last_seen_at: '2026-03-01T00:00:00Z',
    is_online: false,
    workspace_count: 1,
    item_count: 2,
  },
  {
    user_id: '2',
    email: 'adam@x.com',
    display_name: 'Adam',
    created_at: '2026-02-01T00:00:00Z',
    last_sign_in_at: '2026-05-01T00:00:00Z',
    last_seen_at: '2026-05-01T00:00:00Z',
    is_online: true,
    workspace_count: 0,
    item_count: 0,
  },
  {
    user_id: '3',
    email: 'mia@x.com',
    display_name: 'Mia',
    created_at: '2026-03-01T00:00:00Z',
    last_sign_in_at: null,
    last_seen_at: null,
    is_online: false,
    workspace_count: 3,
    item_count: 9,
  },
];

vi.mock('../hooks/useAdminConsole', () => ({
  adminLoginMessage: () => '',
  useAdminConsole: () => ({
    session: { token: 't', expiresAt: '' },
    users,
    workspaces: [],
    audit: [],
    error: null,
    loading: false,
    signIn: vi.fn(),
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

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );

/** Emails in the order the table currently shows them. */
function shownEmails(): string[] {
  const table = screen.getByRole('table');
  const rows = within(table).getAllByRole('row').slice(1); // drop the header
  return rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');
}

describe('admin user table', () => {
  it('shows every account by default', () => {
    renderPage();
    expect(shownEmails()).toHaveLength(3);
  });

  it('sorts by name ascending on request', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(shownEmails()).toEqual(['adam@x.com', 'mia@x.com', 'zara@x.com']);
  });

  it('flips direction when the same column is clicked twice', () => {
    renderPage();
    const name = screen.getByRole('button', { name: /^Name/ });
    fireEvent.click(name);
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(shownEmails()).toEqual(['zara@x.com', 'mia@x.com', 'adam@x.com']);
  });

  it('puts the most recently seen first by default', () => {
    renderPage();
    expect(shownEmails()[0]).toBe('adam@x.com');
  });

  it('keeps the never-seen account last in both directions', () => {
    renderPage();
    const lastSeen = () => screen.getByRole('button', { name: /^Last online/ });
    fireEvent.click(lastSeen()); // already descending -> ascending
    expect(shownEmails().at(-1)).toBe('mia@x.com');
    fireEvent.click(screen.getByRole('button', { name: /Ascending|Descending/ }));
    expect(shownEmails().at(-1)).toBe('mia@x.com');
  });

  it('filters by email as you type', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'zara' } });
    expect(shownEmails()).toEqual(['zara@x.com']);
  });

  it('filters by display name too', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'Mia' } });
    expect(shownEmails()).toEqual(['mia@x.com']);
  });

  it('reports how many matched', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: '@x.com' } });
    expect(screen.getByText(/3 of 3 accounts match/i)).toBeTruthy();
  });

  it('explains an empty result instead of showing a blank table', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'nobody' } });
    expect(screen.getByText(/no account matches/i)).toBeTruthy();
  });

  it('clears the search again', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'zara' } });
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(shownEmails()).toHaveLength(3);
  });

  it('keeps search and sort working together', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(shownEmails()).toEqual(['adam@x.com', 'mia@x.com', 'zara@x.com']);
  });
});
