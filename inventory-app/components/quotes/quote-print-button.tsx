'use client';

export function QuotePrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
    >
      Print
    </button>
  );
}
