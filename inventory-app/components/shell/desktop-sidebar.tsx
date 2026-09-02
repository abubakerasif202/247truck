import Image from 'next/image';
import Link from 'next/link';

import { APP_NAME } from '@/lib/app-config';
import type { AccessSnapshot } from '@/lib/auth/permissions';

import { NavLink } from './nav-link';
import { navLabel, primaryNavItems } from './nav';

export function DesktopSidebar({ access }: { access: AccessSnapshot }) {
  const items = primaryNavItems(access);

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-4 lg:flex"
    >
      <Link href="/dashboard" className="mb-4 flex items-center gap-2">
        <Image
          src="/brand/logo-real-mark.png"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded"
        />
        <span className="text-sm font-semibold">{APP_NAME}</span>
      </Link>

      {items.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          className="flex h-10 items-center rounded-md px-3 text-sm font-medium"
          activeClassName="bg-secondary text-secondary-foreground"
          inactiveClassName="text-muted-foreground hover:bg-secondary/60"
        >
          {navLabel(item, 'desktop')}
        </NavLink>
      ))}
    </nav>
  );
}
