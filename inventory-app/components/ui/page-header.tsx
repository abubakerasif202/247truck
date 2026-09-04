import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageDomain = 'inventory' | 'purchasing' | 'receiving' | 'stock-in' | 'stock-out' | 'used-tyre' | 'customers';

export function PageHeader({ title, subtitle, eyebrow = '24/7 Operations', domain, actions }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: string; domain?: PageDomain; actions?: ReactNode }) {
  return (
    <header className={cn('operations-header', domain && `domain-${domain}`)}>
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div><p className="operations-eyebrow">{eyebrow}</p><h1>{title}</h1>{subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
