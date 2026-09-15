'use client';

import Image from 'next/image';
import type { InvoiceBrand, InvoiceBrandPreview as BrandPreview } from '@/lib/finance/invoice-brands';

const values = (record: Record<string, unknown> | null) => record ? Object.values(record).filter(Boolean).map(String) : [];

export function InvoiceBrandPreview({ brand, brands }: { brand: InvoiceBrand; brands: BrandPreview[] }) {
  const selected = brands.find((item) => item.brand === brand);
  if (!selected) return null;
  const address = values(selected.address);
  const bank = values(selected.bank_instructions);
  return (
    <aside className="rounded-lg border p-4" style={{ borderTopColor: selected.primary_colour ?? undefined, borderTopWidth: 4 }} aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice preview</p>
      <div className="mt-2 flex items-start gap-3">
        {selected.logo_asset_path ? <Image src={selected.logo_asset_path} alt={`${selected.business_name} logo`} width={144} height={40} className="h-10 max-w-36 object-contain" /> : null}
        <div><p className="font-semibold">{selected.business_name}</p>{selected.abn ? <p className="text-xs">ABN {selected.abn}</p> : null}</div>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {address.length ? <p>{address.join(', ')}</p> : null}
        {[selected.phone, selected.email, selected.website].filter(Boolean).map((item) => <p key={item}>{item}</p>)}
        {bank.length ? <p>Payment: {bank.join(' · ')}</p> : null}
        {selected.invoice_footer ? <p>{selected.invoice_footer}</p> : null}
      </div>
    </aside>
  );
}
