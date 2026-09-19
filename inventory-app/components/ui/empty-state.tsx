import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { TyreVisual } from '@/components/ui/tyre-visual';

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  tone = 'neutral',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center',
        tone === 'error' ? 'border-danger/30 bg-danger-soft/30' : 'border-border bg-muted/30',
        className,
      )}
    >
      {Icon ? (
        <span className={cn('flex size-11 items-center justify-center rounded-full', tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-secondary text-brand-steel')}>
          <Icon className="size-5" />
        </span>
      ) : (
        <TyreVisual decorative size="sm" className={cn(tone === 'error' ? 'text-danger/60' : 'text-brand-steel/50')} />
      )}
      <div className="max-w-sm">
        <p className="font-display text-sm uppercase tracking-wide text-foreground">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
