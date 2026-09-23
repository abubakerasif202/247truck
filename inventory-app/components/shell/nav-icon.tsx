import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  CreditCard,
  FileText,
  LayoutDashboard,
  Landmark,
  PackageMinus,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  Wrench,
} from 'lucide-react';

const icons = {
  '/dashboard': LayoutDashboard,
  '/inventory': Boxes,
  '/stock/in': PackagePlus,
  '/stock/out': PackageMinus,
  '/stock/adjust': Settings,
  '/purchasing/purchase-orders': ShoppingCart,
  '/transfers': ArrowLeftRight,
  '/customers': ContactRound,
  '/quotes': FileText,
  '/jobs': Wrench,
  '/pos': CreditCard,
  '/invoices': Receipt,
  '/receivables': Landmark,
  '/settings/users': Users,
  '/settings/reconciliation': ClipboardCheck,
} as const;

export function NavIcon({ href, className = 'size-4' }: { href: string; className?: string }) {
  const Icon = icons[href as keyof typeof icons] ?? ClipboardList;
  return <Icon aria-hidden="true" className={className} />;
}
