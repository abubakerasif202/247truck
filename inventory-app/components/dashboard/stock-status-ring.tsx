/**
 * Segmented ring chart for stock health, built from exact counts already
 * computed server-side (no client JS needed — pure SVG, renders on the server).
 * Never relies on color alone: each segment is paired with a labeled legend row.
 */
const SEGMENTS = [
  { key: 'healthy', label: 'Healthy', colorVar: 'var(--success)' },
  { key: 'low', label: 'Low stock', colorVar: 'var(--warning)' },
  { key: 'out', label: 'Out of stock', colorVar: 'var(--danger)' },
] as const;

export function StockStatusRing({
  healthy,
  low,
  out,
}: {
  healthy: number;
  low: number;
  out: number;
}) {
  const total = healthy + low + out;
  const counts = { healthy, low, out };
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = SEGMENTS.map((seg) => {
    const count = counts[seg.key];
    const fraction = total > 0 ? count / total : 0;
    const length = fraction * circumference;
    const arc = { ...seg, count, fraction, dasharray: `${length} ${circumference - length}`, dashoffset: -offset };
    offset += length;
    return arc;
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label={`Stock status: ${healthy} healthy, ${low} low, ${out} out of stock`}>
        {/* Rotated as an SVG group (user-space, around the circle's own centre) so the
            counter-rotated <text> below can stay untransformed and render upright. */}
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--secondary)" strokeWidth="12" />
          {total > 0
            ? arcs
                .filter((a) => a.count > 0)
                .map((a) => (
                  <circle
                    key={a.key}
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke={a.colorVar}
                    strokeWidth="12"
                    strokeDasharray={a.dasharray}
                    strokeDashoffset={a.dashoffset}
                    strokeLinecap="butt"
                  />
                ))
            : null}
        </g>
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-foreground font-display text-[22px]">
          {total}
        </text>
      </svg>
      <dl className="flex flex-col gap-1.5 text-sm">
        {SEGMENTS.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.colorVar }} />
            <dt className="text-muted-foreground">{seg.label}</dt>
            <dd className="metric-value ml-auto pl-3 font-semibold tabular-nums">{counts[seg.key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
