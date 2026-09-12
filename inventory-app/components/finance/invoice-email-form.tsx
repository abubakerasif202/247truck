'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { sendInvoiceEmailAction } from '@/app/(protected)/invoices/actions';
import type { ActionResult } from '@/lib/action-result';
import type { InvoiceEmailSendStatus } from '@/lib/email/send-status';

type SendResult = ActionResult<{ request_id: string; outcome: 'accepted' | 'failed' | 'uncertain' | 'disabled'; attempt: number; reused: boolean }>;

function ModeButton({ mode, label, primary }: { mode: 'send' | 'retry' | 'resend'; label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="mode"
      value={mode}
      disabled={pending}
      className={primary ? 'h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground' : 'h-10 rounded-md border px-4 text-sm'}
    >
      {pending ? 'Sending…' : label}
    </button>
  );
}

export function InvoiceEmailForm({
  invoiceId,
  revisionId,
  recipient,
  invoiceNumber,
  total,
  sendStatus,
}: {
  invoiceId: string;
  revisionId: string;
  recipient: string;
  invoiceNumber: string;
  total: string;
  sendStatus?: InvoiceEmailSendStatus[];
}) {
  const [state, action] = useActionState<SendResult | undefined, FormData>(sendInvoiceEmailAction.bind(null, invoiceId), undefined);
  const [recipientValue, setRecipientValue] = useState(recipient);
  const latest = (sendStatus ?? []).find((row) => row.recipient === recipientValue.trim().toLowerCase());
  const needsReconciliation = latest?.state === 'uncertain' || latest?.state === 'sending';
  const canRetry = latest && (latest.state === 'failed' || latest.state === 'disabled' || latest.state === 'pending') && !latest.key_expired;
  const retryExpired = latest && latest.state !== 'accepted' && latest.key_expired;

  return (
    <form action={action} className="grid gap-3 rounded-md border p-3">
      <p className="text-sm">
        Confirm sending invoice <strong>{invoiceNumber}</strong> for <strong>${Number(total).toFixed(2)}</strong> with the PDF attached.
      </p>
      <label className="grid gap-1 text-sm">
        Recipient
        <input required type="email" name="recipient" value={recipientValue} onChange={(event) => setRecipientValue(event.target.value)} className="h-10 rounded-md border bg-background px-3" />
      </label>
      <input type="hidden" name="revision_id" value={revisionId} />

      {latest?.state === 'accepted' ? (
        <p className="text-sm text-muted-foreground">
          Accepted by provider on {latest.last_attempted_at ?? latest.created_at}
          {latest.provider_message_id ? ` (message ${latest.provider_message_id})` : ''}.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!latest ? <ModeButton mode="send" label="Send invoice" primary /> : null}
        {canRetry ? (
          <>
            <ModeButton mode="retry" label="Retry send" primary />
            <ModeButton mode="resend" label="Send again (new email)" />
          </>
        ) : null}
        {latest?.state === 'accepted' || (retryExpired && !needsReconciliation) ? <ModeButton mode="resend" label="Send again (new email)" /> : null}
      </div>
      {needsReconciliation ? (
        <p className="text-xs text-destructive">
          The provider outcome is uncertain. An administrator must reconcile this attempt before another email can be sent; starting a new send could create a duplicate.
        </p>
      ) : null}
      {retryExpired && !needsReconciliation ? (
        <p className="text-xs text-muted-foreground">
          The last send was not confirmed and its 24-hour retry window has closed. &quot;Send again&quot; opens a new send with a new idempotency key.
        </p>
      ) : null}
      {canRetry ? (
        <p className="text-xs text-muted-foreground">
          Retry reuses the same provider idempotency key and exact saved payload. &quot;Send again&quot; intentionally sends a new copy.
        </p>
      ) : null}

      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-green-700">Invoice accepted by the email provider and recorded in the delivery history.</p> : null}
    </form>
  );
}
