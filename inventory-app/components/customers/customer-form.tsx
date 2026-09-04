'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CustomerActionState } from '@/app/(protected)/customers/actions';
import type { CustomerDetail } from '@/lib/customers/types';

type Props={action:(previous:CustomerActionState|undefined,form:FormData)=>Promise<CustomerActionState>;requestId?:string;customer?:CustomerDetail};
const fieldClass='grid gap-2';
function ErrorText({messages}:{messages?:string[]}){return messages?.length?<p className="text-sm text-destructive">{messages[0]}</p>:null;}
export function CustomerForm({action,requestId,customer}:Props){
  const [state,formAction,pending]=useActionState(action,undefined);const router=useRouter();
  const [type,setType]=useState(customer?.customer_type??'individual');
  useEffect(()=>{if(state?.ok&&state.customerId)router.push(`/customers/${state.customerId}`)},[state,router]);
  return <form action={formAction} noValidate className="grid gap-6 rounded-xl border bg-card p-4 sm:p-6">
    {requestId?<input type="hidden" name="request_id" value={requestId}/>:null}
    <fieldset className="grid gap-3"><legend className="mb-2 font-semibold">Customer type</legend><div className="grid grid-cols-2 gap-3">
      <label className={`cursor-pointer rounded-lg border p-4 ${type==='individual'?'border-brand-red bg-brand-red-soft':''}`}><input className="mr-2" type="radio" name="customer_type" value="individual" checked={type==='individual'} onChange={()=>setType('individual')}/>Individual</label>
      <label className={`cursor-pointer rounded-lg border p-4 ${type==='business'?'border-brand-red bg-brand-red-soft':''}`}><input className="mr-2" type="radio" name="customer_type" value="business" checked={type==='business'} onChange={()=>setType('business')}/>Business / Fleet</label>
    </div></fieldset>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className={`${fieldClass} sm:col-span-2`}><Label htmlFor="display_name">{type==='business'?'Display name':'Full name'}</Label><Input id="display_name" name="display_name" defaultValue={customer?.display_name??''} required/><ErrorText messages={state?.fieldErrors?.display_name}/></div>
      {type==='individual'?<><div className={fieldClass}><Label htmlFor="first_name">First name</Label><Input id="first_name" name="first_name" defaultValue={customer?.first_name??''}/></div><div className={fieldClass}><Label htmlFor="last_name">Last name</Label><Input id="last_name" name="last_name" defaultValue={customer?.last_name??''}/></div></>:<><div className={fieldClass}><Label htmlFor="company_name">Company / trading name</Label><Input id="company_name" name="company_name" defaultValue={customer?.company_name??''} required/><ErrorText messages={state?.fieldErrors?.company_name}/></div><div className={fieldClass}><Label htmlFor="legal_name">Legal name</Label><Input id="legal_name" name="legal_name" defaultValue={customer?.legal_name??''}/></div><div className={fieldClass}><Label htmlFor="abn">ABN</Label><Input id="abn" name="abn" defaultValue={customer?.abn??''} required/><ErrorText messages={state?.fieldErrors?.abn}/></div><div className={fieldClass}><Label htmlFor="phone">Primary phone</Label><Input id="phone" name="phone" type="tel" defaultValue={customer?.phone??''}/></div></>}
      {type==='individual'?<div className={fieldClass}><Label htmlFor="mobile">Mobile</Label><Input id="mobile" name="mobile" type="tel" defaultValue={customer?.mobile??''} required/><ErrorText messages={state?.fieldErrors?.mobile}/></div>:null}
      <div className={fieldClass}><Label htmlFor="email">{type==='business'?'General email':'Email (optional)'}</Label><Input id="email" name="email" type="email" defaultValue={customer?.email??''}/><ErrorText messages={state?.fieldErrors?.email}/></div>
      {type==='business'?<><div className={fieldClass}><Label htmlFor="billing_email">Billing email</Label><Input id="billing_email" name="billing_email" type="email" defaultValue={customer?.billing_email??''}/></div><div className={fieldClass}><Label htmlFor="accounts_email">Accounts email</Label><Input id="accounts_email" name="accounts_email" type="email" defaultValue={customer?.accounts_email??''}/></div></>:null}
      <div className={`${fieldClass} sm:col-span-2`}><Label htmlFor="street_address">Street address (optional)</Label><Input id="street_address" name="street_address" defaultValue={customer?.street_address??''}/></div>
      <div className={fieldClass}><Label htmlFor="suburb">Suburb</Label><Input id="suburb" name="suburb" defaultValue={customer?.suburb??''} required/></div><div className={fieldClass}><Label htmlFor="state">State</Label><Input id="state" name="state" defaultValue={customer?.state??'SA'} required/></div><div className={fieldClass}><Label htmlFor="postcode">Postcode</Label><Input id="postcode" name="postcode" inputMode="numeric" defaultValue={customer?.postcode??''} required/></div>
      <div className={fieldClass}><Label htmlFor="payment_terms">Payment terms</Label><select id="payment_terms" name="payment_terms" defaultValue={customer?.payment_terms??'due_on_receipt'} className="h-10 rounded-md border bg-background px-3"><option value="due_on_receipt">Due on Receipt</option><option value="7_days">7 Days</option><option value="14_days">14 Days</option><option value="30_days">30 Days</option></select></div>
      {type==='business'?<label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="po_reference_required" defaultChecked={customer?.po_reference_required}/>Customer PO/reference required</label>:null}
      <div className={`${fieldClass} sm:col-span-2`}><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" defaultValue={customer?.notes??''}/></div>
    </div>
    {state?.error?<p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>:null}
    {state?.warnings?.length?<div role="alert" aria-live="polite" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Possible duplicate match</p><p>{state.warnings.join(', ').replaceAll('_',' ').toLowerCase()}. You can still create this customer if it is legitimate.</p></div>:null}
    <Button type="submit" disabled={pending}>{pending?'Saving…':customer?'Save changes':'Create customer'}</Button>
  </form>;
}
