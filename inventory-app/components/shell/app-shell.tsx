import type { ReactNode } from 'react';

import type { LocationScope } from '@/lib/location/scope';
import type { AccessSnapshot } from '@/lib/auth/permissions';

import { DesktopSidebar } from './desktop-sidebar';
import { MobileNav } from './mobile-nav';
import { Topbar } from './topbar';

export function AppShell({
  access,
  scope,
  children,
}: {
  access: AccessSnapshot;
  scope: LocationScope;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-background">
      <DesktopSidebar access={access} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar access={access} scope={scope} />
        <main id="main-content" className="flex-1 pb-24 lg:pb-0">{children}</main>
      </div>
      <MobileNav access={access} />
    </div>
  );
}
