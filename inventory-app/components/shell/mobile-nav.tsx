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
import { NavIcon } from './nav-icon';

export function MobileNav({ access }: { access: AccessSnapshot }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const bar = bottomBarItems(access);
  const more = moreNavItems(access);

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-white/10 bg-brand-near-black pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-10px_30px_rgb(11_12_14/0.18)] lg:hidden"
    >
      {bar.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium"
          activeClassName="bg-brand-graphite text-brand-red-on-dark shadow-[inset_0_3px_var(--brand-red)]"
          inactiveClassName="text-white/55 hover:text-white"
        >
          <NavIcon href={item.href} className="size-5" />
          {navLabel(item, 'mobile')}
        </NavLink>
      ))}

      {more.length > 0 ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-white/55 hover:text-white"
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
                  activeClassName="bg-brand-red-soft text-brand-deep-red"
                  inactiveClassName="text-foreground"
                >
                  <NavIcon href={item.href} className="mr-2 size-4" />
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
