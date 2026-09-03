import { Bell } from 'lucide-react';

import { LocationScopeSelect } from '@/components/location/location-scope-select';
import { logoutAction } from '@/app/(auth)/login/actions';
import type { LocationScope } from '@/lib/location/scope';
import type { AccessSnapshot } from '@/lib/auth/permissions';

export function Topbar({
  access,
  scope,
}: {
  access: AccessSnapshot;
  scope: LocationScope;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/10 bg-brand-black px-4 text-white shadow-sm">
      <LocationScopeSelect access={access} scope={scope} />

      <div className="flex items-center gap-2">
        {/* Visual only in Phase 1 — no notification counts are fabricated. */}
        <Bell
          className="h-5 w-5 text-white/55"
          role="img"
          aria-label="Notifications"
        />
        <form action={logoutAction} noValidate>
          <button
            type="submit"
            className="h-9 rounded-md px-3 text-sm font-medium text-white/65 hover:bg-white/10 hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
