// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Regression cover for the retention authorisation fix (migration 0013).
 *
 * The original panel called `set_retention_enabled`, which wrote a single
 * global row and only checked "is somebody signed in?". A stranger could arm
 * nightly deletion for every workspace on the deployment.
 *
 * The behaviours pinned here are the ones that would have prevented it:
 *   1. the panel always names a workspace and always passes its id, so it can
 *      never mutate "whatever happens to be active";
 *   2. it never calls the removed global RPC;
 *   3. a caller the server says cannot manage gets no switch at all.
 *
 * What these tests deliberately do NOT claim: that the client is the security
 * boundary. It is not — the server enforces it, and
 * supabase/tests/sql/11_retention.sql proves that. These just check the UI does
 * not invite the wrong action.
 */
const rpc = vi.fn();

vi.mock('../../integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  supabaseConfigured: true,
  supabaseUrl: 'https://proj.supabase.co',
  supabasePublishableKey: 'publishable-key',
}));

const success = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success, error: vi.fn(), info: vi.fn() }),
}));

import { RetentionSettings } from './RetentionSettings';

const POLICY = {
  enabled: false,
  cold_after_days: 60,
  trash_after_days: 90,
  purge_after_days: 100,
  can_manage: true,
};

beforeEach(() => {
  rpc.mockReset();
  success.mockReset();
});

afterEach(cleanup);

describe('RetentionSettings', () => {
  it('asks the server about the workspace it was given, not a global policy', async () => {
    rpc.mockResolvedValue({ data: [POLICY], error: null });

    render(<RetentionSettings workspaceId="ws-1" workspaceName="Alpha" />);

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('get_workspace_retention', { p_workspace_id: 'ws-1' }));
    expect(screen.getByText('Alpha', { exact: false })).toBeTruthy();
  });

  it('never calls the removed global toggle', async () => {
    rpc.mockResolvedValue({ data: [POLICY], error: null });
    render(<RetentionSettings workspaceId="ws-1" />);
    const button = await screen.findByRole('button', { name: /turn on auto-cleanup/i });
    fireEvent.click(button);

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const called = rpc.mock.calls.map((call) => call[0]);
    expect(called).not.toContain('set_retention_enabled');
    expect(rpc).toHaveBeenCalledWith('set_workspace_retention', { p_workspace_id: 'ws-1', p_enabled: true });
  });

  it('re-reads the server state after a toggle instead of assuming it worked', async () => {
    rpc.mockResolvedValueOnce({ data: [POLICY], error: null });
    rpc.mockResolvedValueOnce({ data: null, error: null }); // the write
    rpc.mockResolvedValueOnce({ data: [{ ...POLICY, enabled: true }], error: null });
    render(<RetentionSettings workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /turn on auto-cleanup/i }));

    await screen.findByRole('button', { name: /pause auto-cleanup/i });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'get_workspace_retention',
      'set_workspace_retention',
      'get_workspace_retention',
    ]);
  });

  it('offers no switch when the server says the caller cannot manage it', async () => {
    rpc.mockResolvedValue({ data: [{ ...POLICY, can_manage: false }], error: null });

    render(<RetentionSettings workspaceId="ws-1" />);

    await screen.findByText(/only the owner can change this/i);
    expect(screen.queryByRole('button', { name: /auto-cleanup/i })).toBeNull();
  });

  it('surfaces the server error for a workspace the caller cannot read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not a member' } });

    render(<RetentionSettings workspaceId="ws-1" />);

    await waitFor(() => expect(screen.getByText(/not a member/i)).toBeTruthy());
  });
});
