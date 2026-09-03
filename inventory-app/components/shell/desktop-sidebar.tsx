import Image from 'next/image';
import Link from 'next/link';

import type { AccessSnapshot } from '@/lib/auth/permissions';

import { NavLink } from './nav-link';
import { navLabel, primaryNavItems } from './nav';
import { NavIcon } from './nav-icon';

export function DesktopSidebar({ access }: { access: AccessSnapshot }) {
  const items = primaryNavItems(access);

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/10 bg-brand-near-black px-3 py-4 text-white lg:flex"
    >
      <Link
        href="/dashboard"
        prefetch={false}
        className="mb-5 flex items-center gap-3 border-b border-white/10 px-2 pb-5"
      >
        <Image
          src="/brand/logo-real-mark.png"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 rounded-md bg-white object-contain p-1"
        />
        <span><strong className="font-display block text-base uppercase tracking-wide">24/7 Operations</strong><small className="text-[11px] text-white/55">Inventory Control</small></span>
      </Link>

      <p className="mb-1 px-3 font-display text-[10px] uppercase tracking-[0.18em] text-white/40">Operations</p>

      {items.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          className="relative flex h-11 items-center rounded-md px-3 text-sm font-medium transition-colors before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-transparent"
          activeClassName="bg-brand-graphite text-white before:bg-brand-red-on-dark"
          inactiveClassName="text-white/65 hover:bg-white/5 hover:text-white"
        >
          <NavIcon href={item.href} className="mr-2 size-4" />
          {navLabel(item, 'desktop')}
        </NavLink>
      ))}
      <div className="mt-auto border-t border-white/10 px-3 pt-4"><p className="font-display text-xs uppercase tracking-wider text-white/75">24/7 Truck Tyre Services</p><p className="mt-1 text-[11px] text-white/40">Inventory Operations System</p></div>
    </nav>
  );
}
