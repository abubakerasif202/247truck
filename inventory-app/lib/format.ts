const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

export function formatAud(amount: number): string {
  return AUD.format(amount);
}

export function formatAudOrPending(amount: number | null): string {
  return amount == null ? '—' : formatAud(amount);
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago", "yesterday" — for activity feeds. Falls back to "just now" under a minute. */
export function formatRelativeTime(isoDate: string): string {
  const seconds = (Date.parse(isoDate) - Date.now()) / 1000;
  if (Math.abs(seconds) < 60) return 'just now';
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return RELATIVE_TIME.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return RELATIVE_TIME.format(Math.round(seconds / 60), 'minute');
}

/** "Used · Michelin · X Multi · 295/80R22.5" or "—". */
export function formatTyreMeta(parts: {
  condition: 'new' | 'used' | null;
  brand?: string | null;
  pattern?: string | null;
  size?: string | null;
}): string {
  if (!parts.condition) return '—';
  return [
    parts.condition === 'new' ? 'New' : 'Used',
    parts.brand,
    parts.pattern,
    parts.size,
  ]
    .filter(Boolean)
    .join(' · ');
}
