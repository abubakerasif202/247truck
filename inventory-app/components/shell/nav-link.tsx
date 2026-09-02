'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { isActivePath } from './nav';

/**
 * Client leaf that highlights the active route. Keeps `usePathname` out of the
 * otherwise server-rendered shell.
 */
export function NavLink({
  href,
  children,
  className,
  activeClassName,
  inactiveClassName,
  onNavigate,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '';
  const active = isActivePath(pathname, href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(className, active ? activeClassName : inactiveClassName)}
    >
      {children}
    </Link>
  );
}
