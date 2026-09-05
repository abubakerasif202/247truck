'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { updateFinanceSettingsAction } from '@/app/(protected)/settings/finance/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/action-result';
import type {
  BranchFinanceSettings,
  GlobalFinanceSettings,
} from '@/lib/finance/types';

function Field({
  name,
  label,
  defaultValue,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue ?? ''} className="h-11" />
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

type Props =
  | { scope: 'global'; settings: GlobalFinanceSettings }
  | { scope: 'branch'; settings: BranchFinanceSettings };

export function FinanceSettingsForm(props: Props) {
  const [state, formAction] = useActionState<
    ActionResult<{ version: number }> | undefined,
    FormData
  >(updateFinanceSettingsAction, undefined);

  const version =
    state?.ok === true ? state.data.version : props.settings.version;
  const address = 'address' in props.settings ? props.settings.address : null;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="scope" value={props.scope} />
      <input
        type="hidden"
        name="locationId"
        value={props.scope === 'branch' ? props.settings.location_id : ''}
      />
      <input type="hidden" name="expectedVersion" value={version} />

      {props.scope === 'global' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="business_name" label="Legal / business name" defaultValue={props.settings.business_name} />
          <Field name="abn" label="ABN (11 digits)" defaultValue={props.settings.abn} />
          <Field name="phone" label="Phone" defaultValue={props.settings.phone} />
          <Field name="shared_email" label="Shared sender / reply email" type="email" defaultValue={props.settings.shared_email} />
          <Field name="logo_asset_path" label="Logo asset path (repo-relative)" defaultValue={props.settings.logo_asset_path} />
          <Field name="logo_sha256" label="Logo SHA-256" defaultValue={props.settings.logo_sha256} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="branch_name" label="Branch name on documents" defaultValue={props.settings.branch_name} />
          <Field name="phone" label="Branch phone" defaultValue={props.settings.phone} />
          <Field name="contact_email" label="Branch contact email" type="email" defaultValue={props.settings.contact_email} />
        </div>
      )}

      <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Address</legend>
        <Field name="address.street_address" label="Street address" defaultValue={address?.street_address ?? null} />
        <Field name="address.suburb" label="Suburb" defaultValue={address?.suburb ?? null} />
        <Field name="address.state" label="State" defaultValue={address?.state ?? null} />
        <Field name="address.postcode" label="Postcode" defaultValue={address?.postcode ?? null} />
        <Field name="address.country" label="Country" defaultValue={address?.country ?? null} />
      </fieldset>

      {props.scope === 'global' ? (
        <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Bank / payment instructions (global)</legend>
          <Field name="bank.bank_name" label="Bank name" defaultValue={props.settings.bank_instructions?.bank_name ?? null} />
          <Field name="bank.account_name" label="Account name" defaultValue={props.settings.bank_instructions?.account_name ?? null} />
          <Field name="bank.bsb" label="BSB" defaultValue={props.settings.bank_instructions?.bsb ?? null} />
          <Field name="bank.account_number" label="Account number" defaultValue={props.settings.bank_instructions?.account_number ?? null} />
          <Field name="bank.payment_reference" label="Payment reference" defaultValue={props.settings.bank_instructions?.payment_reference ?? null} />
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="bank.instructions">Extra instructions</Label>
            <Textarea id="bank.instructions" name="bank.instructions" defaultValue={props.settings.bank_instructions?.instructions ?? ''} />
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={props.scope === 'global' ? 'invoice_footer' : 'document_footer'}>
          {props.scope === 'global' ? 'Invoice footer' : 'Branch document footer'}
        </Label>
        <Textarea
          id={props.scope === 'global' ? 'invoice_footer' : 'document_footer'}
          name={props.scope === 'global' ? 'invoice_footer' : 'document_footer'}
          defaultValue={
            (props.scope === 'global'
              ? props.settings.invoice_footer
              : props.settings.document_footer) ?? ''
          }
        />
      </div>

      {state?.ok === false ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p role="status" className="text-sm text-emerald-700">
          Saved (version {state.data.version}).
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
