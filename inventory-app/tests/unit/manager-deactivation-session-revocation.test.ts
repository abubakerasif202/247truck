// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  updateUserById: vi.fn(),
  revalidate: vi.fn(),
  access: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/auth/access', () => ({ getCurrentAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}));

import { setManagerActiveAction } from '@/app/(protected)/settings/users/actions';

/**
 * Regression: setManagerActiveAction only ever flipped user_profiles.active
 * via admin_update_manager. Every RLS policy and RPC permission check
 * already gates on profile.active, so the data boundary held -- but nothing
 * touched Supabase Auth, so a dismissed manager's existing session (and any
 * saved refresh token) kept working indefinitely, including read access to
 * the reference tables with USING (true) SELECT policies and the ability to
 * change their own password. Deactivating must also revoke Auth access.
 */
describe('setManagerActiveAction Auth session revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ role: 'admin' });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
  });

  it('bans the Auth user when a manager is deactivated', async () => {
    const result = await setManagerActiveAction('manager-1', false);

    expect(mocks.updateUserById).toHaveBeenCalledWith('manager-1', { ban_duration: '876000h' });
    expect(result).toMatchObject({ ok: true });
  });

  it('lifts the ban when a manager is re-enabled', async () => {
    const result = await setManagerActiveAction('manager-1', true);

    expect(mocks.updateUserById).toHaveBeenCalledWith('manager-1', { ban_duration: 'none' });
    expect(result).toMatchObject({ ok: true });
  });

  it('reports failure and does not claim success if the Auth ban cannot be synced', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await setManagerActiveAction('manager-1', false);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('reconcile') });
  });

  it('does not touch Auth when the profile update itself fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db unavailable' } });

    const result = await setManagerActiveAction('manager-1', false);

    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false });
  });
});
