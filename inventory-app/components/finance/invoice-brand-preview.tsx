'use client';

import Image from 'next/image';
import type { InvoiceBrand, InvoiceBrandPreview as BrandPreview } from '@/lib/finance/invoice-brands';

const values = (record: Record<string, unknown> | null) => record ? Object.values(record).filter(Boolean).map(String) : [];

export function InvoiceBrandPreview({ brand, brands }: { brand: InvoiceBrand; brands: BrandPreview[] }) {
  const selected = brands.find((item) => item.brand === brand);
  if (!selected) return null;
  const address = values(selected.address);
  const bank = values(selected.bank_instructions);
  if (brand === 'awt') return (
    <aside className="overflow-hidden rounded-lg border bg-white text-[#17191c] shadow-sm" aria-live="polite">
      <div className="h-1.5 bg-[#ef1d27]" />
      <div className="space-y-4 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice preview</p>
        <div className="flex items-start justify-between gap-4 border-b-2 border-[#ef1d27] pb-4">
          <div><Image src="/invoice-templates/awt-logo.png" alt="Adelaide Wholesale Tyres logo" width={200} height={83} className="h-auto w-40" unoptimized /><p className="mt-2 text-xs font-bold">ADELAIDE WHOLESALE TYRES</p><p className="text-[11px] text-[#70757c]">adelaidewholesaletyres.com.au &nbsp; | &nbsp; +61 478 827 017</p></div>
          <div className="text-right"><p className="text-xl font-black">TAX INVOICE</p><div className="ml-auto mt-1 h-1 w-24 bg-[#ef1d27]" /><p className="mt-3 text-[10px] text-[#70757c]">INVOICE NO. &nbsp; DATE &nbsp; DUE DATE</p></div>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-md bg-[#f4f5f6] p-3 text-[10px]"><p><b>BUSINESS ABN</b><br/>{selected.abn || '—'}</p><p><b>BUSINESS EMAIL</b><br/>{selected.email || '—'}</p><p><b>BUSINESS ADDRESS</b><br/>{address.join(', ') || '—'}</p></div>
        <div className="grid grid-cols-[2fr_1fr] gap-3 text-[10px]"><section><h3 className="rounded bg-[#17191c] px-3 py-2 font-bold text-white">BILL TO</h3><p className="mt-2 border-b py-2">Customer / business name and frozen contact details</p></section><section><h3 className="rounded bg-[#17191c] px-3 py-2 font-bold text-white">REFERENCE</h3><p className="mt-2 border-b py-2">PO / Order No. · Vehicle / Rego</p></section></div>
        <section className="text-[10px]"><h3 className="grid grid-cols-[3fr_.5fr_1fr_.7fr_1fr] gap-2 rounded bg-[#17191c] px-3 py-2 font-bold text-white"><span>Description / Tyre size / Pattern</span><span>Qty</span><span>Unit price</span><span>GST</span><span>Amount</span></h3>{[1,2,3].map((row) => <div key={row} className="mt-1 h-7 border border-[#d7dade]" />)}</section>
        <div className="grid grid-cols-[1.6fr_1fr] gap-3 text-[10px]"><section><h3 className="rounded bg-[#17191c] px-3 py-2 font-bold text-white">PAYMENT DETAILS &amp; NOTES</h3><p className="mt-2">{bank.length ? bank.join(' · ') : 'Configured AWT payment details'}</p></section><section className="rounded bg-[#f4f5f6] p-3 font-semibold"><p>SUBTOTAL</p><p>DISCOUNT</p><p>GST</p><p className="text-[#ef1d27]">TOTAL</p><p>AMOUNT PAID</p><p className="text-[#ef1d27]">BALANCE DUE</p></section></div>
        <p className="border-t pt-3 text-[10px] text-[#70757c]">Thank you for choosing Adelaide Wholesale Tyres. Please quote the invoice number with payment.</p>
      </div>
    </aside>
  );
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
