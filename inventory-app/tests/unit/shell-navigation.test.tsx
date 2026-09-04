import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    prefetch,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a {...props} data-prefetch={String(prefetch)} />
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
}));

import { LocationScopeSelect } from '../../components/location/location-scope-select';
import { DesktopSidebar } from '../../components/shell/desktop-sidebar';
import { MobileNav } from '../../components/shell/mobile-nav';
import {
  bottomBarItems,
  isActivePath,
  moreNavItems,
  primaryNavItems,
} from '../../components/shell/nav';
import type { AccessSnapshot } from '../../lib/auth/permissions';

const manager: AccessSnapshot = {
  userId: 'm1',
  role: 'manager',
  locationId: 'l1',
  locationCode: 'LON',
  permissions: ['inventory.view', 'inventory.stock_in', 'inventory.stock_out'],
};

const admin: AccessSnapshot = {
  userId: 'a1',
  role: 'admin',
  locationId: null,
  locationCode: null,
  permissions: [],
};

describe('shell navigation', () => {
  it('shows a Manager the operational links but no branch switching or Users', () => {
    render(<DesktopSidebar access={manager} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('Stock In')).toBeInTheDocument();
    expect(screen.getByText('Stock Out')).toBeInTheDocument();
    expect(screen.queryByText('Adjust Stock')).not.toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
  });

  it('marks the active route with aria-current', () => {
    render(<DesktopSidebar access={manager} />);
    expect(screen.getByText('Inventory')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Dashboard')).not.toHaveAttribute('aria-current');
  });

  it('disables automatic prefetch for operational navigation links', () => {
    render(<DesktopSidebar access={admin} />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('data-prefetch', 'false');
    }
  });

  it('shows a Manager their fixed branch name, not a scope selector', () => {
    render(
      <LocationScopeSelect
        access={manager}
        scope={{ kind: 'location', code: 'LON' }}
      />,
    );

    expect(screen.getByText('Lonsdale')).toBeInTheDocument();
    expect(screen.queryByText('All Locations')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('gives an Admin every link including Users', () => {
    render(<DesktopSidebar access={admin} />);

    for (const label of [
      'Dashboard',
      'Inventory',
      'Stock In',
      'Stock Out',
      'Adjust Stock',
      'Users',
      'Purchasing',
      'Transfers',
      'Customers',
      'Quotes',
      'Jobs',
      'POS',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('gives an Admin a scope selector with both branches', () => {
    render(<LocationScopeSelect access={admin} scope={{ kind: 'all' }} />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('All Locations')).toBeInTheDocument();
    expect(screen.getByText('Lonsdale')).toBeInTheDocument();
    expect(screen.getByText('Regency Park')).toBeInTheDocument();
  });

  it('renders the mobile bottom bar with permission-gated actions', () => {
    render(<MobileNav access={manager} />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Stock')).toBeInTheDocument();
    expect(screen.getByText('Stock In')).toBeInTheDocument();
    expect(screen.getByText('Stock Out')).toBeInTheDocument();
    // Manager without inventory.adjust and non-admin has nothing in "More".
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('shows the mobile "More" trigger to an Admin', () => {
    render(<MobileNav access={admin} />);
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('splits nav items between bar and more placements', () => {
    expect(bottomBarItems(admin).map((i) => i.href)).toEqual([
      '/dashboard',
      '/inventory',
      '/stock/in',
      '/stock/out',
    ]);
    expect(moreNavItems(admin).map((i) => i.href)).toEqual([
      '/stock/adjust',
      '/purchasing/purchase-orders',
      '/transfers',
      '/customers',
      '/quotes',
      '/jobs',
      '/pos',
      '/settings/users',
    ]);
  });

  it('primaryNavItems is permission-driven', () => {
    expect(primaryNavItems(manager).map((item) => item.label)).toEqual([
      'Dashboard',
      'Inventory',
      'Stock In',
      'Stock Out',
    ]);
  });

  it('shows Purchasing in More for an authorized Manager, never the bottom bar', () => {
    const purchasingManager = {
      ...manager,
      permissions: [...manager.permissions, 'purchasing.view' as const],
    };
    expect(moreNavItems(purchasingManager).map((item) => item.label)).toContain('Purchasing');
    expect(bottomBarItems(purchasingManager).map((item) => item.label)).not.toContain('Purchasing');
    render(<MobileNav access={purchasingManager} />);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: 'Purchasing' })).toBeInTheDocument();
  });

  it('shows Customers only to a Manager with customers.view', () => {
    expect(moreNavItems(manager).map((item) => item.label)).not.toContain('Customers');
    const permitted = { ...manager, permissions: [...manager.permissions, 'customers.view' as const] };
    expect(moreNavItems(permitted).map((item) => item.label)).toContain('Customers');
  });

  it('does not add More for a Manager solely because Purchasing is hidden', () => {
    expect(moreNavItems(manager)).toHaveLength(0);
    render(<MobileNav access={manager} />);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('isActivePath matches exact and nested paths only', () => {
    expect(isActivePath('/stock/in', '/stock/in')).toBe(true);
    expect(isActivePath('/stock/in/new', '/stock/in')).toBe(true);
    expect(isActivePath('/stock', '/stock/in')).toBe(false);
    expect(isActivePath('/inventory', '/stock/in')).toBe(false);
  });
});
