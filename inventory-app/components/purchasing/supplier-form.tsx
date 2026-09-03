'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createSupplierAction,
  updateSupplierAction,
  type SupplierActionResult,
} from '@/app/(protected)/purchasing/suppliers/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SupplierSummary } from '@/lib/purchasing/types';

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save supplier' : 'Create supplier'}
    </Button>
  );
}

export function SupplierForm({ supplier }: { supplier?: SupplierSummary }) {
  const action = supplier
    ? updateSupplierAction.bind(null, supplier.id)
    : createSupplierAction;
  const [state, formAction] = useActionState<
    SupplierActionResult | undefined,
    FormData
  >(action, undefined);

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor={`supplier-name-${supplier?.id ?? 'new'}`}>Supplier name</Label>
        <Input
          id={`supplier-name-${supplier?.id ?? 'new'}`}
          name="name"
          defaultValue={supplier?.name ?? ''}
          required
          maxLength={160}
          className="h-11"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`supplier-abn-${supplier?.id ?? 'new'}`}>ABN</Label>
          <Input id={`supplier-abn-${supplier?.id ?? 'new'}`} name="abn" defaultValue={supplier?.abn ?? ''} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`supplier-account-${supplier?.id ?? 'new'}`}>Account reference</Label>
          <Input
            id={`supplier-account-${supplier?.id ?? 'new'}`}
            name="accountReference"
            defaultValue={supplier?.accountReference ?? ''}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`supplier-contact-${supplier?.id ?? 'new'}`}>Contact</Label>
          <Input
            id={`supplier-contact-${supplier?.id ?? 'new'}`}
            name="contactName"
            defaultValue={supplier?.contactName ?? ''}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`supplier-phone-${supplier?.id ?? 'new'}`}>Phone</Label>
          <Input
            id={`supplier-phone-${supplier?.id ?? 'new'}`}
            name="phone"
            type="tel"
            defaultValue={supplier?.phone ?? ''}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`supplier-email-${supplier?.id ?? 'new'}`}>Email</Label>
        <Input
          id={`supplier-email-${supplier?.id ?? 'new'}`}
          name="email"
          type="email"
          defaultValue={supplier?.email ?? ''}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`supplier-address-${supplier?.id ?? 'new'}`}>Address</Label>
        <Textarea
          id={`supplier-address-${supplier?.id ?? 'new'}`}
          name="address"
          rows={2}
          className="resize-none"
          defaultValue={supplier?.address ?? ''}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`supplier-terms-${supplier?.id ?? 'new'}`}>Payment terms</Label>
        <Input
          id={`supplier-terms-${supplier?.id ?? 'new'}`}
          name="paymentTerms"
          placeholder="e.g. 30 days"
          defaultValue={supplier?.paymentTerms ?? ''}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`supplier-notes-${supplier?.id ?? 'new'}`}>Notes</Label>
        <Textarea
          id={`supplier-notes-${supplier?.id ?? 'new'}`}
          name="notes"
          rows={3}
          className="resize-none"
          defaultValue={supplier?.notes ?? ''}
        />
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : state?.ok ? (
        <p role="status" className="text-sm text-muted-foreground">Supplier saved.</p>
      ) : null}

      <SubmitButton editing={Boolean(supplier)} />
    </form>
  );
}
