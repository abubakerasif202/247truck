'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  completeJobAndCreateInvoiceAction,
  createInvoiceFromJobAction,
} from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action-result';

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-10" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/** Shown on a completed job with no invoice yet. On success the server action
 * redirects to the new invoice (a client push would race the job-page
 * revalidation that unmounts this button). Only the error path reaches state. */
export function CreateInvoiceFromJobButton({ jobId }: { jobId: string }) {
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    () => createInvoiceFromJobAction(jobId),
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <Pending label="Create invoice" busy="Creating…" />
      </form>
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}

/** Shown while completing a not-yet-completed job: one atomic transaction. */
export function CompleteAndInvoiceButton({ jobId, version }: { jobId: string; version: number }) {
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    () => completeJobAndCreateInvoiceAction(jobId, version),
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <Pending label="Complete & create invoice" busy="Working…" />
      </form>
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}
