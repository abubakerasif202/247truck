import Link from 'next/link';
import { Boxes, ContactRound, FileText, PackageMinus, PackagePlus, Receipt, ShoppingCart, type LucideIcon } from 'lucide-react';

import { hasPermission, type PermissionCarrier } from '@/lib/auth/permissions';

type QuickAction = { href: string; label: string; icon: LucideIcon; visible: (access: PermissionCarrier) => boolean };

const ACTIONS: readonly QuickAction[] = [
  { href: '/stock/in', label: 'Receive stock', icon: PackagePlus, visible: (a) => hasPermission(a, 'inventory.stock_in') },
  { href: '/stock/out', label: 'Issue stock', icon: PackageMinus, visible: (a) => hasPermission(a, 'inventory.stock_out') },
  { href: '/inventory/new', label: 'Add product', icon: Boxes, visible: (a) => a.role === 'admin' },
  { href: '/purchasing/purchase-orders/new', label: 'New purchase order', icon: ShoppingCart, visible: (a) => hasPermission(a, 'purchasing.create_po') },
  { href: '/customers/new', label: 'Add customer', icon: ContactRound, visible: (a) => hasPermission(a, 'customers.create') },
  { href: '/quotes/new', label: 'New quote', icon: FileText, visible: (a) => hasPermission(a, 'quotes.create') },
  { href: '/invoices/new', label: 'New invoice', icon: Receipt, visible: (a) => hasPermission(a, 'invoices.create') },
];

export function QuickActions({ access }: { access: PermissionCarrier }) {
  const actions = ACTIONS.filter((a) => a.visible(access));
  if (actions.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {actions.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-brand-red/40 hover:bg-brand-red-soft/60"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-red-soft text-brand-deep-red transition-colors group-hover:bg-brand-red group-hover:text-white">
            <Icon className="size-4" />
          </span>
          {label}
        </Link>
      ))}
    </div>
  );
}
