// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), lookup: vi.fn(), deleteUser: vi.fn(), revalidate: vi.fn(), access: vi.fn(),
  invite: vi.fn(), list: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/auth/access', () => ({ getCurrentAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'location' }, error: null }) }) }) }),
}) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({
  auth: { admin: { listUsers: mocks.list, inviteUserByEmail: mocks.invite, deleteUser: mocks.deleteUser } },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }),
}) }));
import { inviteManagerAction } from '@/app/(protected)/settings/users/actions';

function form() {
  const result = new FormData();
  result.set('email', 'manager@example.test');
  result.set('displayName', 'Test Manager');
  result.set('locationCode', 'REG');
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ role: 'admin' });
  mocks.list.mockResolvedValue({ data: { users: [] }, error: null });
  mocks.invite.mockResolvedValue({ data: { user: { id: 'invited-user' } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'admin_begin_manager_invitation') return { data: 'operation', error: null };
    if (name === 'admin_complete_manager_invitation') return { data: null, error: { message: 'fetch failed' } };
    return { data: null, error: null };
  });
});

describe('uncertain invitation completion', () => {
  it('retains a committed account when the completion response was lost', async () => {
    mocks.lookup.mockResolvedValue({ data: { status: 'completed', auth_user_id: 'invited-user' }, error: null });
    expect(await inviteManagerAction(undefined, form())).toMatchObject({ ok: true });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_set_invitation_compensation', expect.anything());
  });

  it.each([
    { data: { status: 'pending_auth', auth_user_id: null }, error: null },
    { data: null, error: { message: 'lookup unavailable' } },
    { data: { status: 'completed', auth_user_id: 'different-user' }, error: null },
  ])('preserves the account for manual recovery when completion is unproven', async (lookup) => {
    mocks.lookup.mockResolvedValue(lookup);
    const result = await inviteManagerAction(undefined, form());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Admin recovery') });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_invitation_compensation', expect.objectContaining({ p_compensated: false }));
  });
});
