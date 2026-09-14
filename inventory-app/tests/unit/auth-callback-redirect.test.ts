import { describe, expect, it } from 'vitest';

import { resolveSafeNext } from '../../app/(auth)/auth/callback/route';

const ORIGIN = 'https://inventory.example.com';

describe('resolveSafeNext', () => {
  it('defaults when next is missing', () => {
    expect(resolveSafeNext(ORIGIN, null)).toBe('/onboarding/set-password');
  });

  it('allows a same-origin absolute path', () => {
    expect(resolveSafeNext(ORIGIN, '/dashboard')).toBe('/dashboard');
  });

  it('preserves query and hash on a same-origin path', () => {
    expect(resolveSafeNext(ORIGIN, '/jobs?tab=open#top')).toBe('/jobs?tab=open#top');
  });

  it('rejects userinfo-injection payloads like "@evil.com"', () => {
    // `${origin}${next}` string concatenation with this value would resolve
    // to a URL whose host is evil.com — this must fall back to the default.
    expect(resolveSafeNext(ORIGIN, '@evil.com')).toBe('/onboarding/set-password');
  });

  it('rejects a protocol-relative host override', () => {
    expect(resolveSafeNext(ORIGIN, '//evil.com')).toBe('/onboarding/set-password');
  });

  it('rejects a fully-qualified cross-origin URL', () => {
    expect(resolveSafeNext(ORIGIN, 'https://evil.com/phish')).toBe('/onboarding/set-password');
  });

  it('rejects a bare relative path with no leading slash', () => {
    expect(resolveSafeNext(ORIGIN, 'dashboard')).toBe('/onboarding/set-password');
  });
});
