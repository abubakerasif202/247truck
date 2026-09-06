'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type EditableLine = {
  id?: string;
  description: string;
  quantity: string;
  unit_price_incl_gst: string;
  discount_percent: string;
  discount_reason: string;
  /** Job-sourced product lines: identity/qty/price locked; only discount + wording editable. */
  locked?: boolean;
};

function lineTotal(line: EditableLine): number | null {
  if (line.unit_price_incl_gst.trim() === '') return null;
  const qty = Number(line.quantity || '0');
  const price = Number(line.unit_price_incl_gst || '0');
  const base = Math.round(qty * price * 100) / 100;
  const disc = Math.round(base * (Number(line.discount_percent || '0') / 100) * 100) / 100;
  return base - disc;
}

export function InvoiceLineEditor({
  name = 'lines',
  initial,
  allowAddRemove = true,
}: {
  name?: string;
  initial: EditableLine[];
  allowAddRemove?: boolean;
}) {
  const [lines, setLines] = useState<EditableLine[]>(
    initial.length
      ? initial
      : [{ description: '', quantity: '1', unit_price_incl_gst: '', discount_percent: '0', discount_reason: '' }],
  );

  const serialized = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          ...(line.id ? { id: line.id } : {}),
          line_type: 'labour',
          description: line.description,
          quantity: line.quantity,
          unit_price_incl_gst: line.unit_price_incl_gst.trim() === '' ? null : line.unit_price_incl_gst,
          discount_percent: line.discount_percent || '0',
          discount_reason: line.discount_reason || null,
        })),
      ),
    [lines],
  );

  const total = lines.reduce((sum, line) => {
    const value = lineTotal(line);
    return value === null ? sum : sum + value;
  }, 0);
  const anyPending = lines.some((line) => lineTotal(line) === null);

  function patch(index: number, key: keyof EditableLine, value: string) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name={name} value={serialized} />
      {lines.map((line, index) => (
        <div key={line.id ?? index} className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <Label htmlFor={`desc-${index}`}>Description</Label>
              <Input
                id={`desc-${index}`}
                value={line.description}
                onChange={(event) => patch(index, 'description', event.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor={`qty-${index}`}>Qty</Label>
              <Input
                id={`qty-${index}`}
                value={line.quantity}
                inputMode="decimal"
                disabled={line.locked}
                onChange={(event) => patch(index, 'quantity', event.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor={`price-${index}`}>Unit price (incl GST)</Label>
              <Input
                id={`price-${index}`}
                value={line.unit_price_incl_gst}
                inputMode="decimal"
                placeholder="Pending"
                disabled={line.locked}
                onChange={(event) => patch(index, 'unit_price_incl_gst', event.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor={`disc-${index}`}>Discount %</Label>
              <Input
                id={`disc-${index}`}
                value={line.discount_percent}
                inputMode="decimal"
                onChange={(event) => patch(index, 'discount_percent', event.target.value)}
                className="h-11"
              />
            </div>
          </div>
          {Number(line.discount_percent || '0') > 0 ? (
            <div className="mt-3">
              <Label htmlFor={`dr-${index}`}>Discount reason (required)</Label>
              <Input
                id={`dr-${index}`}
                value={line.discount_reason}
                onChange={(event) => patch(index, 'discount_reason', event.target.value)}
                className="h-11"
              />
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {lineTotal(line) === null ? 'Price pending' : `$${lineTotal(line)!.toFixed(2)} incl GST`}
            </span>
            {allowAddRemove && !line.locked && lines.length > 1 ? (
              <button
                type="button"
                className="text-destructive"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {allowAddRemove ? (
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() =>
            setLines((prev) => [
              ...prev,
              { description: '', quantity: '1', unit_price_incl_gst: '', discount_percent: '0', discount_reason: '' },
            ])
          }
        >
          Add service line
        </Button>
      ) : null}
      <p className="text-right text-sm font-semibold">
        {anyPending ? 'Total pending — priced when every line has a price' : `$${total.toFixed(2)} incl GST`}
      </p>
    </div>
  );
}
