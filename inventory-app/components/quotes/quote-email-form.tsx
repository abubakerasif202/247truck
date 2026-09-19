'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendQuoteEmailAction } from '@/app/(protected)/quotes/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { QuoteEmailSendStatus } from '@/lib/email/quote-send-status';

function SendButton({ mode, label, primary }: { mode: 'send' | 'retry' | 'resend'; label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="mode"
      value={mode}
      disabled={pending}
      className={
        primary
          ? 'flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-brand-crimson disabled:pointer-events-none disabled:opacity-50'
          : 'flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-50'
      }
    >
      {pending ? 'Sending…' : label}
    </button>
  );
}

export function QuoteEmailForm({ quoteId, recipient, quoteNumber, total, sendStatus }: { quoteId: string; recipient: string; quoteNumber: string; total: string; sendStatus: QuoteEmailSendStatus[] }) {
  const [state, action] = useActionState(sendQuoteEmailAction.bind(null, quoteId), undefined);
  const [recipientValue, setRecipientValue] = useState(recipient);
  const latest = sendStatus.find((row) => row.recipient === recipientValue.trim().toLowerCase());
  const blocked = latest?.state === 'uncertain' || latest?.state === 'sending';
  const canRetry = latest && ['failed', 'disabled', 'pending'].includes(latest.state) && !latest.key_expired;

  return (
    <form action={action} className="grid gap-3 text-sm">
      <p>
        Send quote <strong>{quoteNumber}</strong> for <strong>${Number(total).toFixed(2)}</strong> with the customer PDF attached.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="quote_email_recipient">Recipient</Label>
        <Input
          id="quote_email_recipient"
          required
          type="email"
          name="recipient"
          value={recipientValue}
          onChange={(event) => setRecipientValue(event.target.value)}
          className="h-10"
        />
      </div>
      {latest?.state === 'accepted' ? (
        <p className="text-sm text-muted-foreground">Accepted by provider on {latest.last_attempted_at ?? latest.created_at}.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!latest ? <SendButton mode="send" label="Email quote" primary /> : null}
        {canRetry ? (
          <>
            <SendButton mode="retry" label="Retry send" primary />
            <SendButton mode="resend" label="Send again (new email)" />
          </>
        ) : null}
        {latest?.state === 'accepted' || (latest && latest.key_expired && !blocked) ? (
          <SendButton mode="resend" label="Send again (new email)" />
        ) : null}
      </div>
      {blocked ? (
        <p className="text-xs text-destructive">The provider outcome is uncertain. Reconciliation is required before another send.</p>
      ) : null}
      {canRetry ? (
        <p className="text-xs text-muted-foreground">Retry reuses the saved quote PDF and provider idempotency key. Send again intentionally creates a new delivery.</p>
      ) : null}
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-success">Quote accepted by the email provider and recorded in delivery history.</p> : null}
    </form>
  );
}
