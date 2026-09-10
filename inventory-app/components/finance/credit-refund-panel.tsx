'use client';

import { useActionState, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/action-result';
import type { InvoiceResult } from '@/lib/finance/types';

type Line = { id: string; description: string; total_incl_gst: string | number | null };
type Payment = { id: string; method: string; amount: string | number; reversed?: boolean };
type Refund = { id: string; amount: string | number; status: string; version: number; payment_id: string };
type Credit = { id: string; credit_note_number: string; total_incl_gst: string | number; authorised_refund_amount: string | number; reason: string };
type Action = (previous: ActionResult<InvoiceResult> | undefined, form: FormData) => Promise<ActionResult<InvoiceResult>>;

export function CreditRefundPanel({ version, lines, payments, credits, refunds, financials, canMutate, createAction, confirmAction, retryAction }: {
  version: number; lines: Line[]; payments: Payment[]; credits: Credit[]; refunds: Refund[]; financials: Record<string, unknown>; canMutate: boolean;
  createAction: Action; confirmAction: (refundId: string, previous: ActionResult<InvoiceResult> | undefined, form: FormData) => Promise<ActionResult<InvoiceResult>>;
  retryAction: (refundId: string, previous: ActionResult<InvoiceResult> | undefined, form: FormData) => Promise<ActionResult<InvoiceResult>>;
}) {
  const [selectedLine, setSelectedLine] = useState(lines[0]?.id ?? ''); const [amount, setAmount] = useState(''); const [cash, setCash] = useState('0'); const [payment, setPayment] = useState(payments.find((p) => !p.reversed)?.id ?? ''); const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, submit, pending] = useActionState(async (prev: ActionResult<InvoiceResult> | undefined, form: FormData) => {
    const result = await createAction(prev, form);
    if (result.ok) setRequestId(crypto.randomUUID());
    return result;
  }, undefined);
  const available = payments.filter((p) => !p.reversed);
  const payload = JSON.stringify({ request_id: requestId, expected_version: version, reason, credit_lines: [{ invoice_line_id: selectedLine, amount }], authorised_refund_amount: cash, payments: cash !== '0' ? [{ payment_id: payment || available[0]?.id || '', amount: cash }] : [] });
  return <section className="rounded-xl border bg-card p-5 text-sm" aria-labelledby="credit-refund-heading">
    <h2 id="credit-refund-heading" className="font-semibold">Credit / refund</h2>
    <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2"><span>Invoice total: ${Number(financials.total ?? 0).toFixed(2)}</span><span>Credits: ${Number(financials.credits ?? 0).toFixed(2)}</span><span>Gross paid: ${Number(financials.gross_paid ?? 0).toFixed(2)}</span><span>Refunded: ${Number(financials.actual_net_cash ?? 0) < 0 ? '0.00' : (Number(financials.gross_paid ?? 0) - Number(financials.actual_net_cash ?? 0)).toFixed(2)}</span><span>Applied to sale: ${Number(financials.applied_to_sale ?? 0).toFixed(2)}</span><span>Outstanding: ${Number(financials.balance ?? 0).toFixed(2)}</span><span>Refund due: ${Number(financials.refund_due ?? 0).toFixed(2)}</span></div>
    {canMutate && lines.length ? <form action={submit} className="mt-4 grid gap-3 rounded-md border p-3"><p className="font-medium">Credit only or credit + cash return</p><div><Label htmlFor="credit-line">Invoice line</Label><select id="credit-line" value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3">{lines.map((line) => <option key={line.id} value={line.id}>{line.description} · ${Number(line.total_incl_gst ?? 0).toFixed(2)}</option>)}</select></div><div><Label htmlFor="credit-amount">Credit amount incl GST</Label><Input id="credit-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" step="0.01" min="0.01" required /></div><div><Label htmlFor="refund-amount">Cash return (optional)</Label><Input id="refund-amount" value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" step="0.01" min="0" required /></div>{cash !== '0' ? <div><Label htmlFor="refund-payment">Original payment</Label><select id="refund-payment" value={payment} onChange={(e) => setPayment(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3">{available.map((p) => <option key={p.id} value={p.id}>{p.method.replace('_', ' ')} · ${Number(p.amount).toFixed(2)}</option>)}</select></div> : null}<div><Label htmlFor="credit-reason">Reason</Label><Textarea id="credit-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required /></div><input type="hidden" name="payload" value={payload} /><Button type="submit" disabled={pending || !selectedLine}>{pending ? 'Saving…' : cash === '0' ? 'Issue credit note' : 'Issue credit + refund'}</Button>{state && !state.ok ? <p role="alert" className="text-destructive">{state.error}</p> : null}<p className="text-xs text-muted-foreground">Does not return stock.</p></form> : null}
    {credits.length ? <div className="mt-4 grid gap-2"><h3 className="font-medium">Credit history</h3>{credits.map((credit) => <p key={credit.id}>{credit.credit_note_number} · ${Number(credit.total_incl_gst).toFixed(2)} · cash authorised ${Number(credit.authorised_refund_amount).toFixed(2)} · {credit.reason}</p>)}</div> : null}
    {refunds.length ? <div className="mt-4 grid gap-3"><h3 className="font-medium">Refund payout history</h3>{refunds.map((refund) => <RefundRow key={refund.id} refund={refund} action={confirmAction} retry={retryAction} canMutate={canMutate} />)}</div> : null}
  </section>;
}

function RefundRow({ refund, action, retry, canMutate }: { refund: Refund; action: CreditRefundPanelProps['confirmAction']; retry: CreditRefundPanelProps['retryAction']; canMutate: boolean }) {
  const [confirmRequestId, setConfirmRequestId] = useState(() => crypto.randomUUID());
  const [retryRequestId, setRetryRequestId] = useState(() => crypto.randomUUID());
  const confirmForm = async (previous: ActionResult<InvoiceResult> | undefined, form: FormData) => {
    const result = await action(refund.id, previous, form);
    if (result.ok) setConfirmRequestId(crypto.randomUUID());
    return result;
  };
  const retryForm = async (previous: ActionResult<InvoiceResult> | undefined, form: FormData) => {
    const result = await retry(refund.id, previous, form);
    if (result.ok) setRetryRequestId(crypto.randomUUID());
    return result;
  };
  const [confirmResult, confirmFormAction, confirmFormPending] = useActionState(confirmForm, undefined);
  const [retryResult, retryFormAction, retryFormPending] = useActionState(retryForm, undefined);
  return <article className="rounded-md border p-3"><p>${Number(refund.amount).toFixed(2)} · {refund.status}</p>{canMutate && refund.status === 'pending' ? <form action={confirmFormAction} className="mt-2 grid gap-2"><input type="hidden" name="request_id" value={confirmRequestId}/><input type="hidden" name="expected_version" value={refund.version}/><select name="payout_method" className="h-10 rounded-md border bg-background px-3"><option value="cash">Cash</option><option value="eftpos">EFTPOS</option><option value="bank_transfer">Bank transfer</option></select><Input name="payout_reference" placeholder="Payout reference" required/><Textarea name="evidence" placeholder="Evidence of actual payout" required/><Button type="submit" disabled={confirmFormPending}>{confirmFormPending ? 'Confirming…' : 'Confirm payout occurred'}</Button>{confirmResult && !confirmResult.ok ? <p className="text-destructive">{confirmResult.error}</p> : null}</form> : null}{canMutate && refund.status === 'failed' ? <form action={retryFormAction} className="mt-2"><input type="hidden" name="request_id" value={retryRequestId}/><input type="hidden" name="expected_version" value={refund.version}/><Button type="submit" variant="outline" disabled={retryFormPending}>{retryFormPending ? 'Retrying…' : 'Retry failed payout'}</Button>{retryResult && !retryResult.ok ? <p className="text-destructive">{retryResult.error}</p> : null}</form> : null}<p className="mt-1 text-xs text-muted-foreground">Original payment: {refund.payment_id}</p></article>;
}
type CreditRefundPanelProps = ComponentProps<typeof CreditRefundPanel>;
