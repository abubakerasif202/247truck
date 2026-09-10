'use client';
import { useActionState, useMemo, useState } from 'react';
import type { ActionResult } from '@/lib/action-result';
import { paymentWarning } from '@/lib/finance/payment-policy';
import type { PaymentRow } from '@/lib/finance/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Result = { invoice_id: string; version?: number; payment_ids?: string[] };
type RecordAction = (previous: ActionResult<Result> | undefined, form: FormData) => Promise<ActionResult<Result>>;
type ReverseAction = (paymentId: string, previous: ActionResult<Result> | undefined, form: FormData) => Promise<ActionResult<Result>>;
const requestId = () => crypto.randomUUID();

function ReverseForm({ payment, version, action }: { payment: PaymentRow; version: number; action: ReverseAction }) {
  const [id, setId] = useState(requestId);
  const submitAction = async (previous: ActionResult<Result> | undefined, form: FormData) => {
    const result = await action(payment.id, previous, form);
    if (result.ok) setId(requestId());
    return result;
  };
  const [state, submit, pending] = useActionState(submitAction, undefined);
  return <form action={submit} className="mt-2 grid gap-2 rounded-md border p-3">
    <input type="hidden" name="request_id" value={id}/><Label htmlFor={`reverse-${payment.id}`}>Reversal reason</Label>
    <input type="hidden" name="expected_version" value={version}/>
    <Textarea id={`reverse-${payment.id}`} name="reason" required minLength={3} maxLength={500}/>
    {state && !state.ok ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <Button type="submit" variant="outline" disabled={pending}>{pending ? 'Reversing…' : 'Reverse full payment'}</Button>
  </form>;
}

export function PaymentPanel({ invoiceId, version, balance, payments, recordAction, reverseAction, canRecord = false, canReverse = false }: {
  invoiceId: string; version: number; balance: string; payments: PaymentRow[]; recordAction: RecordAction; reverseAction: ReverseAction; canRecord?: boolean; canReverse?: boolean;
}) {
  const [id, setId] = useState(requestId);
  const [method, setMethod] = useState<'cash'|'eftpos'|'bank_transfer'>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const submitAction = async (previous: ActionResult<Result> | undefined, form: FormData) => {
    const result = await recordAction(previous, form);
    if (result.ok) setId(requestId());
    return result;
  };
  const [state, submit, pending] = useActionState(submitAction, undefined);
  const warning = useMemo(() => paymentWarning(method, reference, payments.flatMap((p) => p.reference ? [p.reference] : [])), [method, reference, payments]);
  return <section className="rounded-xl border bg-card p-5 text-sm" aria-labelledby="payments-heading">
    <h2 id="payments-heading" className="font-semibold">Payments</h2><p className="mt-1 text-muted-foreground">Outstanding balance: <strong>${Number(balance).toFixed(2)}</strong></p>
    {canRecord && Number(balance) > 0 ? <form action={submit} className="mt-4 grid gap-3">
      <input data-testid="payment-request-id" type="hidden" name="request_id" value={id}/><input type="hidden" name="invoice_id" value={invoiceId}/><input type="hidden" name="expected_version" value={version}/>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="payment_method">Method</Label><select id="payment_method" name="method" value={method} onChange={(e)=>setMethod(e.target.value as typeof method)} className="mt-1 h-11 w-full rounded-md border bg-background px-3"><option value="cash">Cash</option><option value="eftpos">EFTPOS</option><option value="bank_transfer">Bank transfer</option></select></div><div><Label htmlFor="payment_amount">Payment amount</Label><Input id="payment_amount" name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" required value={amount} onChange={(e)=>setAmount(e.target.value)}/></div></div>
      <div><Label htmlFor="payment_reference">Reference (optional)</Label><Input id="payment_reference" name="reference" maxLength={500} value={reference} onChange={(e)=>setReference(e.target.value)}/></div>
      <div><Label htmlFor="payment_notes">Notes (optional)</Label><Textarea id="payment_notes" name="notes" maxLength={500} value={notes} onChange={(e)=>setNotes(e.target.value)}/></div>
      {warning ? <p role="status" className="rounded-md bg-muted p-2">{warning}</p> : null}{state && !state.ok ? <p role="alert" className="rounded-md bg-destructive/10 p-2 text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Record payment'}</Button>
    </form> : null}
    <div className="mt-5 grid gap-3">{payments.length === 0 ? <p className="text-muted-foreground">No payments recorded.</p> : payments.map((payment) => <article key={payment.id} className="rounded-md border p-3"><div className="flex flex-wrap justify-between gap-2"><span><strong>${Number(payment.amount).toFixed(2)}</strong> · {payment.method.replace('_',' ')}{payment.reference ? ` · ${payment.reference}` : ''}</span><span>{payment.reversed ? 'Reversed' : 'Succeeded'}</span></div><p className="text-muted-foreground">Received {payment.received_at}</p>{payment.notes ? <p>{payment.notes}</p> : null}{payment.reversal ? <p className="text-destructive">Reversed: {payment.reversal.reason}</p> : null}{canReverse && !payment.reversed ? <details><summary className="mt-2 cursor-pointer underline">Correct this payment</summary><ReverseForm payment={payment} version={version} action={reverseAction}/></details> : null}</article>)}</div>
  </section>;
}
