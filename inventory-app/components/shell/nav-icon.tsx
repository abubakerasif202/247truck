import { Boxes, ClipboardList, ContactRound, LayoutDashboard, PackageMinus, PackagePlus, Settings, ShoppingCart, Users } from 'lucide-react';

const icons = {
  '/dashboard': LayoutDashboard,
  '/inventory': Boxes,
  '/stock/in': PackagePlus,
  '/stock/out': PackageMinus,
  '/stock/adjust': Settings,
  '/purchasing/purchase-orders': ShoppingCart,
  '/settings/users': Users,
  '/customers': ContactRound,
} as const;

export function NavIcon({ href, className = 'size-4' }: { href: string; className?: string }) {
  const Icon = icons[href as keyof typeof icons] ?? ClipboardList;
  return <Icon aria-hidden="true" className={className} />;
}
