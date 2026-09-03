import { hasPermission, type AccessSnapshot } from '@/lib/auth/permissions';
import type { PermissionKey } from '@/lib/auth/types';

export type NavPlacement = 'bar' | 'more';

export type NavItem = {
  href: string;
  /** Desktop sidebar label. */
  label: string;
  /** Shorter label for the mobile bottom bar; falls back to `label`. */
  mobileLabel?: string;
  permission?: PermissionKey;
  adminOnly?: boolean;
  /**
   * `bar`  → desktop sidebar + mobile bottom bar.
   * `more` → desktop sidebar + mobile "More" sheet.
   */
  placement: NavPlacement;
};

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', mobileLabel: 'Home', placement: 'bar' },
  { href: '/inventory', label: 'Inventory', mobileLabel: 'Stock', placement: 'bar' },
  {
    href: '/stock/in',
    label: 'Stock In',
    permission: 'inventory.stock_in',
    placement: 'bar',
  },
  {
    href: '/stock/out',
    label: 'Stock Out',
    permission: 'inventory.stock_out',
    placement: 'bar',
  },
  {
    href: '/stock/adjust',
    label: 'Adjust Stock',
    permission: 'inventory.adjust',
    placement: 'more',
  },
  {
    href: '/purchasing/purchase-orders',
    label: 'Purchasing',
    permission: 'purchasing.view',
    placement: 'more',
  },
  { href: '/settings/users', label: 'Users', adminOnly: true, placement: 'more' },
];

function isVisible(item: NavItem, access: AccessSnapshot): boolean {
  if (item.adminOnly) return access.role === 'admin';
  if (item.permission) return hasPermission(access, item.permission);
  return true;
}

/** Every nav item the user may see (desktop sidebar order). */
export function primaryNavItems(access: AccessSnapshot): NavItem[] {
  return NAV_ITEMS.filter((item) => isVisible(item, access));
}

/** Items for the mobile bottom bar. */
export function bottomBarItems(access: AccessSnapshot): NavItem[] {
  return primaryNavItems(access).filter((item) => item.placement === 'bar');
}

/** Items for the mobile "More" sheet. */
export function moreNavItems(access: AccessSnapshot): NavItem[] {
  return primaryNavItems(access).filter((item) => item.placement === 'more');
}

export function navLabel(item: NavItem, variant: 'desktop' | 'mobile'): string {
  return variant === 'mobile' ? (item.mobileLabel ?? item.label) : item.label;
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
