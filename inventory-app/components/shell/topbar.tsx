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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4">
      <LocationScopeSelect access={access} scope={scope} />

      <div className="flex items-center gap-2">
        {/* Visual only in Phase 1 — no notification counts are fabricated. */}
        <Bell
          className="h-5 w-5 text-muted-foreground"
          role="img"
          aria-label="Notifications"
        />
        <form action={logoutAction}>
          <button
            type="submit"
            className="h-9 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-secondary/60"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
