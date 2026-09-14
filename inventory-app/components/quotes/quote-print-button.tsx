'use client';

export function QuotePrintButton() {
  return <button type="button" onClick={() => window.print()} className="h-10 rounded-md border px-4 text-sm">Print</button>;
}
