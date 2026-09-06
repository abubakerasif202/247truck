'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createManualInvoiceAction } from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/action-result';

import { InvoiceLineEditor } from './invoice-line-editor';

type BranchOption = { id: string; label: string };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Creating…' : 'Create draft invoice'}
    </Button>
  );
}

export function ManualInvoiceForm({
  branches,
  customerId,
}: {
  branches: BranchOption[];
  customerId: string | null;
}) {
  // On success the server action redirects to the new invoice; only the error
  // path reaches `state`.
  const [state, formAction] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    createManualInvoiceAction,
    undefined,
  );

  return (
    <form
      action={(formData) => {
        const payload = {
          location_id: formData.get('location_id') || undefined,
          customer_id: customerId,
          payment_terms: formData.get('payment_terms') || undefined,
          customer_reference: formData.get('customer_reference') || null,
          customer_notes: formData.get('customer_notes') || null,
          lines: JSON.parse(String(formData.get('lines') ?? '[]')),
        };
        const next = new FormData();
        next.set('payload', JSON.stringify(payload));
        return formAction(next);
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      {branches.length > 1 ? (
        <div>
          <Label htmlFor="location_id">Branch</Label>
          <select id="location_id" name="location_id" className="h-11 w-full rounded-md border px-3 text-sm">
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="location_id" value={branches[0]?.id ?? ''} />
      )}

      <div>
        <Label htmlFor="payment_terms">Payment terms</Label>
        <select id="payment_terms" name="payment_terms" className="h-11 w-full rounded-md border px-3 text-sm">
          <option value="due_on_receipt">Due on receipt</option>
          <option value="7_days">7 days</option>
          <option value="14_days">14 days</option>
          <option value="30_days">30 days</option>
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Individuals and walk-ins are always due on receipt.</p>
      </div>

      <div>
        <Label htmlFor="customer_reference">Customer reference (optional)</Label>
        <Input id="customer_reference" name="customer_reference" className="h-11" />
      </div>
      <div>
        <Label htmlFor="customer_notes">Notes on the invoice (optional)</Label>
        <Textarea id="customer_notes" name="customer_notes" />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Service lines</h2>
        <InvoiceLineEditor initial={[]} />
        <p className="mt-2 text-xs text-muted-foreground">
          Manual invoices carry labour and service charges only. To sell stock, use a workshop job or POS.
        </p>
      </div>

      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit />
    </form>
  );
}
