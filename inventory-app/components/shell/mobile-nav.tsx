'use client';

import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { AccessSnapshot } from '@/lib/auth/permissions';

import { NavLink } from './nav-link';
import { bottomBarItems, moreNavItems, navLabel } from './nav';

export function MobileNav({ access }: { access: AccessSnapshot }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const bar = bottomBarItems(access);
  const more = moreNavItems(access);

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {bar.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium"
          activeClassName="text-foreground"
          inactiveClassName="text-muted-foreground"
        >
          {navLabel(item, 'mobile')}
        </NavLink>
      ))}

      {more.length > 0 ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted-foreground"
          >
            More
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
            <SheetHeader>
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 p-2">
              {more.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  onNavigate={() => setMoreOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
                  activeClassName="bg-secondary text-secondary-foreground"
                  inactiveClassName="text-foreground"
                >
                  {navLabel(item, 'desktop')}
                </NavLink>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </nav>
  );
}
