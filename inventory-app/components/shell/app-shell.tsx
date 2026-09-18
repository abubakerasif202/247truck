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
      <a
        href="#main-content"
        className="sr-only fixed top-4 left-4 z-[60] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm focus:not-sr-only"
      >
        Skip to main content
      </a>
      <DesktopSidebar access={access} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar access={access} scope={scope} />
        <main id="main-content" className="flex-1 pb-24 lg:pb-0">{children}</main>
      </div>
      <MobileNav access={access} />
    </div>
  );
}
