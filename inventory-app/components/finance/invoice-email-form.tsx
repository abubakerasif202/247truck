'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { sendInvoiceEmailAction } from '@/app/(protected)/invoices/actions';
import type { ActionResult } from '@/lib/action-result';

function Submit() { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground">{pending ? 'Sending…' : 'Send invoice'}</button>; }

export function InvoiceEmailForm({ invoiceId, revisionId, recipient, invoiceNumber, total }: { invoiceId: string; revisionId: string; recipient: string; invoiceNumber: string; total: string }) {
  const [state, action] = useActionState<ActionResult<{ delivery_id?: string }> | undefined, FormData>(sendInvoiceEmailAction.bind(null, invoiceId), undefined);
  return <form action={action} className="grid gap-3 rounded-md border p-3">
    <p className="text-sm">Confirm sending invoice <strong>{invoiceNumber}</strong> for <strong>${Number(total).toFixed(2)}</strong> with the PDF attached.</p>
    <label className="grid gap-1 text-sm">Recipient<input required type="email" name="recipient" defaultValue={recipient} className="h-10 rounded-md border bg-background px-3" /></label>
    <input type="hidden" name="revision_id" value={revisionId} />
    <Submit />
    {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    {state?.ok ? <p className="text-sm text-green-700">Invoice sent and recorded in the delivery history.</p> : null}
  </form>;
}
