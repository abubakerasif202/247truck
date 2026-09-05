'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';

import { reviseUnpaidInvoiceAction, updateInvoiceDraftAction } from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/action-result';

import { InvoiceLineEditor, type EditableLine } from './invoice-line-editor';

type Mode = 'draft' | 'revise';

type RevisionLine = {
  id: string;
  line_type: string;
  description: string;
  quantity: string;
  unit_price_incl_gst: string | null;
  discount_percent: string;
  discount_reason: string | null;
  source_job_line_id: string | null;
};

function Submit({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Saving…' : mode === 'revise' ? 'Create revision' : 'Save draft'}
    </Button>
  );
}

export function InvoiceDraftEditor({
  mode,
  invoiceId,
  version,
  paymentTerms,
  customerReference,
  customerNotes,
  lines,
  sourceType,
}: {
  mode: Mode;
  invoiceId: string;
  version: number;
  paymentTerms: string;
  customerReference: string | null;
  customerNotes: string | null;
  lines: RevisionLine[];
  sourceType: 'job' | 'pos' | 'manual';
}) {
  const router = useRouter();
  const action = mode === 'revise' ? reviseUnpaidInvoiceAction : updateInvoiceDraftAction;
  const [state, formAction] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    action.bind(null, invoiceId),
    undefined,
  );

  useEffect(() => {
    if (state?.ok) router.push(`/invoices/${invoiceId}`);
  }, [state, invoiceId, router]);

  const editable: EditableLine[] = lines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unit_price_incl_gst: line.unit_price_incl_gst ?? '',
    discount_percent: line.discount_percent,
    discount_reason: line.discount_reason ?? '',
    locked: line.source_job_line_id !== null,
  }));

  return (
    <form
      action={(formData) => {
        const rawLines = JSON.parse(String(formData.get('lines') ?? '[]')) as Array<Record<string, unknown>>;
        const payload: Record<string, unknown> = {
          expected_version: version,
          payment_terms: formData.get('payment_terms') || undefined,
          customer_reference: formData.get('customer_reference') || null,
          customer_notes: formData.get('customer_notes') || null,
        };
        if (mode === 'revise') {
          payload.revision_reason = formData.get('revision_reason');
          payload.lines = rawLines
            .filter((line) => line.id)
            .map((line) => ({
              id: line.id,
              description: line.description,
              discount_percent: line.discount_percent ?? '0',
              discount_reason: line.discount_reason ?? null,
            }));
        } else {
          payload.lines = rawLines;
        }
        const next = new FormData();
        next.set('payload', JSON.stringify(payload));
        formAction(next);
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      {mode === 'revise' ? (
        <div>
          <Label htmlFor="revision_reason">Reason for this revision (required)</Label>
          <Input id="revision_reason" name="revision_reason" className="h-11" required />
        </div>
      ) : null}

      <div>
        <Label htmlFor="payment_terms">Payment terms</Label>
        <select
          id="payment_terms"
          name="payment_terms"
          defaultValue={paymentTerms}
          className="h-11 w-full rounded-md border px-3 text-sm"
        >
          <option value="due_on_receipt">Due on receipt</option>
          <option value="7_days">7 days</option>
          <option value="14_days">14 days</option>
          <option value="30_days">30 days</option>
        </select>
      </div>
      <div>
        <Label htmlFor="customer_reference">Customer reference</Label>
        <Input id="customer_reference" name="customer_reference" defaultValue={customerReference ?? ''} className="h-11" />
      </div>
      <div>
        <Label htmlFor="customer_notes">Notes on the invoice</Label>
        <Textarea id="customer_notes" name="customer_notes" defaultValue={customerNotes ?? ''} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Lines</h2>
        <InvoiceLineEditor initial={editable} allowAddRemove={mode === 'draft' && sourceType === 'manual'} />
        {sourceType !== 'manual' ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Lines from the source job keep their product, quantity and price. Only discounts and wording can change.
          </p>
        ) : null}
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-destructive">
          {state.error}
          {state.error.toLowerCase().includes('reload') ? ' Your entries above are kept.' : ''}
        </p>
      ) : null}
      <Submit mode={mode} />
    </form>
  );
}
