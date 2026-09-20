import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const TONES = {
  inventory: { border: 'border-t-inventory', bg: 'bg-inventory-soft/40', icon: 'bg-inventory-soft text-inventory' },
  warning: { border: 'border-t-warning', bg: 'bg-warning-soft/50', icon: 'bg-warning-soft text-warning' },
  brand: { border: 'border-t-brand-red', bg: 'bg-brand-red-soft/45', icon: 'bg-brand-red-soft text-brand-deep-red' },
  success: { border: 'border-t-success', bg: 'bg-success-soft/40', icon: 'bg-success-soft text-success' },
  danger: { border: 'border-t-danger', bg: 'bg-danger-soft/40', icon: 'bg-danger-soft text-danger' },
  neutral: { border: 'border-t-brand-steel', bg: '', icon: 'bg-secondary text-brand-charcoal' },
} as const;

export type MetricTone = keyof typeof TONES;

export function MetricCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'neutral',
  trend,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: MetricTone;
  /** Optional small delta/trend chip, e.g. "+12 this week". Only render when backed by real historical data. */
  trend?: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div className={cn('operations-panel flex flex-col gap-2 border-t-2 p-4', t.border, t.bg, className)}>
      {/*
       * Deliberately a <span>, not a <div>: tests/e2e/inventory-admin.spec.ts locates
       * `div` elements that "have" the "Inventory value" text and asserts the LAST
       * match contains "—". A second nested <div> wrapping just the label (without
       * the <dd> value) would become that "last" match and break the assertion.
       */}
      <span className="flex items-start justify-between gap-2">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        {Icon ? (
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', t.icon)}>
            <Icon className="size-4" />
          </span>
        ) : null}
      </span>
      <dd className="metric-value text-3xl leading-none">{value}</dd>
      {caption || trend ? (
        <span className="flex items-center justify-between gap-2">
          {caption ? <span className="text-[11px] text-muted-foreground">{caption}</span> : <span />}
          {trend}
        </span>
      ) : null}
    </div>
  );
}
