'use client';

import { useActionState } from 'react';
import { updateInvoiceBrandSettingsAction } from '@/app/(protected)/settings/finance/actions';
import type { InvoiceBrandPreview } from '@/lib/finance/invoice-brands';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const value = (record: Record<string, unknown> | null, key: string) => record?.[key] == null ? '' : String(record[key]);
function Field({ name, label, initial, type='text' }: { name: string; label: string; initial?: string | null; type?: string }) { return <div className="grid gap-1"><Label htmlFor={`${name}-${label}`}>{label}</Label><Input id={`${name}-${label}`} name={name} type={type} defaultValue={initial ?? ''} /></div>; }

export function InvoiceBrandSettingsForm({ settings }: { settings: InvoiceBrandPreview }) {
  const [state, action] = useActionState(updateInvoiceBrandSettingsAction, undefined);
  const version = state?.ok ? state.data.version : settings.version ?? 1;
  return <form action={action} className="flex flex-col gap-5" noValidate>
    <input type="hidden" name="brand" value={settings.brand}/><input type="hidden" name="expectedVersion" value={version}/>
    <div className="grid gap-4 sm:grid-cols-2"><Field name="business_name" label="Business name" initial={settings.business_name}/><Field name="abn" label="ABN" initial={settings.abn}/><Field name="phone" label="Phone" initial={settings.phone}/><Field name="email" label="Business email" initial={settings.email} type="email"/><Field name="website" label="Website" initial={settings.website}/><Field name="reply_to_address" label="Reply-to" initial={settings.reply_to_address} type="email"/><Field name="email_sender_name" label="Email display name" initial={settings.email_sender_name}/><Field name="logo_asset_path" label="Logo asset path" initial={settings.logo_asset_path}/><Field name="primary_colour" label="Primary colour" initial={settings.primary_colour}/><Field name="accent_colour" label="Accent colour" initial={settings.accent_colour}/></div>
    <fieldset className="operations-panel grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
      <legend className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Address</legend>
      {['street_address','suburb','state','postcode','country'].map((key) => <Field key={key} name={`address.${key}`} label={key.replaceAll('_',' ')} initial={value(settings.address,key)}/>)}
    </fieldset>
    <fieldset className="operations-panel grid gap-4 border-l-2 border-l-brand-steel p-4 sm:grid-cols-2 sm:p-5">
      <legend className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Payment details</legend>
      {['bank_name','account_name','bsb','account_number','payment_reference','instructions'].map((key) => <Field key={key} name={`bank.${key}`} label={key.replaceAll('_',' ')} initial={value(settings.bank_instructions,key)}/>)}
    </fieldset>
    <div className="operations-panel flex flex-col gap-1.5 p-4 sm:p-5">
      <Label htmlFor={`footer-${settings.brand}`}>Invoice footer</Label>
      <Textarea id={`footer-${settings.brand}`} name="invoice_footer" defaultValue={settings.invoice_footer ?? ''}/>
    </div>
    {state && !state.ok ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    {state?.ok ? <p role="status" className="text-sm text-emerald-700">Saved.</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" className="h-11 min-w-32">Save {settings.business_name} brand</Button>
      <Button type="reset" variant="ghost" className="h-11">Reset</Button>
    </div>
  </form>;
}
