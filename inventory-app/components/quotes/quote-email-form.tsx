'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendQuoteEmailAction } from '@/app/(protected)/quotes/actions';
import type { QuoteEmailSendStatus } from '@/lib/email/quote-send-status';

function Button({ mode, label, primary }: { mode: 'send' | 'retry' | 'resend'; label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="mode" value={mode} disabled={pending} className={primary ? 'h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground' : 'h-10 rounded-md border px-4 text-sm'}>{pending ? 'Sending…' : label}</button>;
}

export function QuoteEmailForm({ quoteId, recipient, quoteNumber, total, sendStatus }: { quoteId: string; recipient: string; quoteNumber: string; total: string; sendStatus: QuoteEmailSendStatus[] }) {
  const [state, action] = useActionState(sendQuoteEmailAction.bind(null, quoteId), undefined);
  const [recipientValue, setRecipientValue] = useState(recipient);
  const latest = sendStatus.find((row) => row.recipient === recipientValue.trim().toLowerCase());
  const blocked = latest?.state === 'uncertain' || latest?.state === 'sending';
  const canRetry = latest && ['failed', 'disabled', 'pending'].includes(latest.state) && !latest.key_expired;
  return <form action={action} className="grid gap-3 rounded-md border p-3"><p className="text-sm">Send quote <strong>{quoteNumber}</strong> for <strong>${Number(total).toFixed(2)}</strong> with the customer PDF attached.</p><label className="grid gap-1 text-sm">Recipient<input required type="email" name="recipient" value={recipientValue} onChange={(event) => setRecipientValue(event.target.value)} className="h-10 rounded-md border bg-background px-3" /></label>{latest?.state === 'accepted' ? <p className="text-sm text-muted-foreground">Accepted by provider on {latest.last_attempted_at ?? latest.created_at}.</p> : null}<div className="flex flex-wrap gap-2">{!latest ? <Button mode="send" label="Email quote" primary /> : null}{canRetry ? <><Button mode="retry" label="Retry send" primary /><Button mode="resend" label="Send again (new email)" /></> : null}{latest?.state === 'accepted' || (latest && latest.key_expired && !blocked) ? <Button mode="resend" label="Send again (new email)" /> : null}</div>{blocked ? <p className="text-xs text-destructive">The provider outcome is uncertain. Reconciliation is required before another send.</p> : null}{canRetry ? <p className="text-xs text-muted-foreground">Retry reuses the saved quote PDF and provider idempotency key. Send again intentionally creates a new delivery.</p> : null}{state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}{state?.ok ? <p className="text-sm text-green-700">Quote accepted by the email provider and recorded in delivery history.</p> : null}</form>;
}
