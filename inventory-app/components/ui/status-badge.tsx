import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'border-brand-steel/25 bg-secondary text-brand-charcoal',
  info: 'border-info/25 bg-info-soft text-info',
  success: 'border-success/25 bg-success-soft text-success',
  receiving: 'border-receiving/25 bg-receiving-soft text-receiving',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  danger: 'border-danger/25 bg-danger-soft text-danger',
  inventory: 'border-inventory/25 bg-inventory-soft text-inventory',
  used: 'border-used-tyre/25 bg-used-tyre-soft text-used-tyre',
} as const;
export type StatusTone = keyof typeof tones;
export function statusTone(status: string): StatusTone {
  const key = status.toLowerCase().replaceAll(' ', '_');
  if (['approved', 'received', 'active', 'complete', 'completed', 'ok', 'paid', 'accepted', 'converted_to_job', 'succeeded'].includes(key)) return 'success';
  // 'sent' and 'issued' are the same invoice lifecycle moment described two
  // ways (list view renders display_status="sent", detail view renders the
  // raw DB status "issued") — same tone, or the same invoice shows a
  // different badge colour on its own list vs detail page.
  if (['sent', 'issued', 'in_progress', 'scheduled'].includes(key)) return 'receiving';
  if (['submitted', 'new', 'new_tyre'].includes(key)) return 'info';
  if (['partially_received', 'low', 'low_stock', 'attention', 'partial', 'partially_paid', 'waiting', 'expired'].includes(key)) return 'warning';
  if (['rejected', 'cancelled', 'out_of_stock', 'inactive', 'archived', 'void', 'overdue', 'declined'].includes(key)) return 'danger';
  if (['used', 'used_tyre'].includes(key)) return 'used';
  return 'neutral';
}
export function StatusBadge({ children, status, tone, className }: { children: ReactNode; status?: string; tone?: StatusTone; className?: string }) {
  const resolved = tone ?? statusTone(status ?? String(children));
  return <span className={cn('inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold', tones[resolved], className)}>{children}</span>;
}
