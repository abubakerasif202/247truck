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
