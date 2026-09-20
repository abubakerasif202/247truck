import { cn } from '@/lib/utils';

const SIZES = { sm: 40, md: 64, lg: 112, xl: 160 } as const;
export type TyreVisualSize = keyof typeof SIZES;

/**
 * Generic heavy-vehicle tyre illustration — local inline SVG, currentColor
 * only, no external asset or manufacturer branding. Used wherever a product
 * has no photo: product detail hero, inventory cards, empty states.
 */
export function TyreVisual({
  size = 'md',
  condition,
  decorative = false,
  className,
}: {
  size?: TyreVisualSize;
  condition?: 'new' | 'used' | null;
  /** True when adjacent visible text already conveys the meaning (e.g. inside an EmptyState). */
  decorative?: boolean;
  className?: string;
}) {
  const px = SIZES[size];
  const outerR = 46;
  const hubR = 20;
  const treadCount = 28;
  const treadBlocks = Array.from({ length: treadCount }, (_, i) => {
    const angle = (i / treadCount) * Math.PI * 2;
    const inner = outerR - 7;
    const outer = outerR - 1;
    return {
      key: i,
      x1: 50 + Math.cos(angle) * inner,
      y1: 50 + Math.sin(angle) * inner,
      x2: 50 + Math.cos(angle) * outer,
      y2: 50 + Math.sin(angle) * outer,
    };
  });
  const bolts = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    return { key: i, x: 50 + Math.cos(angle) * (hubR - 5), y: 50 + Math.sin(angle) * (hubR - 5) };
  });

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : condition === 'used' ? 'Used tyre' : 'Tyre'}
      className={cn('text-brand-steel', className)}
    >
      <circle cx="50" cy="50" r={outerR} fill="none" stroke="currentColor" strokeWidth="5" opacity="0.85" />
      {treadBlocks.map((b) => (
        <line key={b.key} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
      ))}
      <circle cx="50" cy="50" r={hubR} fill="none" stroke="currentColor" strokeWidth="4" opacity="0.85" />
      <circle cx="50" cy="50" r="4" fill="currentColor" opacity="0.5" />
      {bolts.map((b) => (
        <circle key={b.key} cx={b.x} cy={b.y} r="2" fill="currentColor" opacity="0.5" />
      ))}
    </svg>
  );
}
