// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrentAccess: vi.fn(), set: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/access', () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }));

import { setLocationScopeAction } from '@/app/(protected)/actions';

/**
 * Regression: the cookie's `secure` flag derived from `NODE_ENV ===
 * 'production'`, which fails OPEN (sends the cookie over plain HTTP) if a
 * self-hosted deployment ever runs without NODE_ENV set to exactly
 * 'production'. It now fails CLOSED -- secure by default, with only the
 * local `next dev` server (NODE_ENV === 'development') exempted. Low blast
 * radius either way (the cookie is documented as view-preference only, never
 * trusted for authorisation), but there is no reason to ever send it
 * unencrypted outside local development.
 */
describe('setLocationScopeAction cookie Secure flag', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccess.mockResolvedValue({ role: 'admin' });
  });

  afterEach(() => {
    vi.stubEnv('NODE_ENV', originalNodeEnv ?? 'test');
  });

  it('sets Secure when NODE_ENV is unset (fails closed, not open)', async () => {
    vi.stubEnv('NODE_ENV', '');
    await setLocationScopeAction('ALL');
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ secure: true }));
  });

  it('sets Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await setLocationScopeAction('ALL');
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ secure: true }));
  });

  it('only omits Secure for the local dev server', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await setLocationScopeAction('ALL');
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ secure: false }));
  });
});
