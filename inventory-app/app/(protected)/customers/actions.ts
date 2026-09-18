'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { customerFromForm } from '@/lib/customers/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type CustomerActionState={ok:boolean;error?:string;fieldErrors?:Record<string,string[]>;customerId?:string;customerNumber?:string;warnings?:string[]};
const value=(f:FormData,k:string)=>String(f.get(k)??'').trim();
const friendly=(message:string)=>{const code=message.match(/(?:^|: )([A-Z][A-Z0-9_]+)$/)?.[1]??'';const known=new Set(['ACCESS_DENIED','CUSTOMER_NOT_FOUND','CUSTOMER_VERSION_CONFLICT','IDEMPOTENCY_KEY_REUSED','PRIMARY_CONTACT_EXISTS','CONTACT_NOT_FOUND','VEHICLE_NOT_FOUND','BUSINESS_CUSTOMER_REQUIRED','INVALID_VEHICLE_TYPE','VEHICLE_REGISTRATION_REQUIRED']);return known.has(code)?code.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase()):'The customer change could not be saved.';};
const resultError=(error: {message?:string}|null|undefined):CustomerActionState=>({ok:false,error:friendly(error?.message??'')});
const contactPayload=(form:FormData)=>({first_name:value(form,'first_name'),last_name:value(form,'last_name')||null,role_title:value(form,'role_title')||null,mobile:value(form,'mobile')||null,phone:value(form,'phone')||null,email:value(form,'email')||null,primary_contact:form.get('primary_contact')==='on',billing_contact:form.get('billing_contact')==='on',notes:value(form,'notes')||null});
const vehiclePayload=(form:FormData)=>({vehicle_type:value(form,'vehicle_type'),registration:value(form,'registration'),fleet_number:value(form,'fleet_number')||null,make:value(form,'make')||null,model:value(form,'model')||null,year:value(form,'year')?Number(value(form,'year')):null,vin:value(form,'vin')||null,body_description:value(form,'body_description')||null,axle_configuration_notes:value(form,'axle_configuration_notes')||null,tyre_notes:value(form,'tyre_notes')||null,notes:value(form,'notes')||null});

export async function createCustomerAction(_previous:CustomerActionState|undefined,form:FormData):Promise<CustomerActionState>{
  const access=await getCurrentAccess(); if(!hasPermission(access,'customers.create')) return {ok:false,error:'You do not have permission to create customers.'};
  const parsed=customerFromForm(form); if(!parsed.success) return {ok:false,error:'Check the highlighted fields.',fieldErrors:parsed.error.flatten().fieldErrors};
  const {data,error}=await (await createServerSupabaseClient()).rpc('create_customer',{p_request_id:value(form,'request_id')||randomUUID(),p_customer:parsed.data});
  if(error)return {ok:false,error:friendly(error.message)}; revalidatePath('/customers');
  return {ok:true,customerId:data.customer_id,customerNumber:data.customer_number,warnings:data.warnings??[]};
}

export async function updateCustomerAction(id:string,version:number,_previous:CustomerActionState|undefined,form:FormData):Promise<CustomerActionState>{
  const access=await getCurrentAccess(); if(!hasPermission(access,'customers.edit'))return {ok:false,error:'You do not have permission to edit customers.'};
  const parsed=customerFromForm(form); if(!parsed.success)return {ok:false,error:'Check the highlighted fields.',fieldErrors:parsed.error.flatten().fieldErrors};
  const {error}=await (await createServerSupabaseClient()).rpc('update_customer',{p_customer_id:id,p_expected_version:version,p_customer:parsed.data});
  if(error)return {ok:false,error:friendly(error.message)}; revalidatePath('/customers');revalidatePath(`/customers/${id}`);return {ok:true,customerId:id};
}

export async function setCustomerActiveAction(id:string,active:boolean):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.edit'))return {ok:false,error:'You do not have permission to edit customers.'};const {error}=await(await createServerSupabaseClient()).rpc('set_customer_active',{p_customer_id:id,p_active:active});if(error)return resultError(error);revalidatePath('/customers');revalidatePath(`/customers/${id}`);return {ok:true,customerId:id};}

export async function addContactAction(customerId:string,form:FormData):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.manage_contacts'))return {ok:false,error:'You do not have permission to manage contacts.'};const {data,error}=await(await createServerSupabaseClient()).rpc('add_customer_contact',{p_customer_id:customerId,p_contact:contactPayload(form)});if(error)return resultError(error);revalidatePath(`/customers/${customerId}`);return {ok:true,customerId,customerNumber:data?.contact_id};}
export async function updateContactAction(contactId:string,customerId:string,form:FormData):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.manage_contacts'))return {ok:false,error:'You do not have permission to manage contacts.'};const {error}=await(await createServerSupabaseClient()).rpc('update_customer_contact',{p_contact_id:contactId,p_contact:contactPayload(form)});if(error)return resultError(error);revalidatePath(`/customers/${customerId}`);return {ok:true,customerId};}
export async function archiveContactAction(customerId:string,contactId:string):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.manage_contacts'))return {ok:false,error:'You do not have permission to manage contacts.'};const {error}=await(await createServerSupabaseClient()).rpc('archive_customer_contact',{p_contact_id:contactId});if(error)return resultError(error);revalidatePath(`/customers/${customerId}`);return {ok:true,customerId};}
export async function addVehicleAction(customerId:string,form:FormData):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.manage_vehicles'))return {ok:false,error:'You do not have permission to manage vehicles.'};const {data,error}=await(await createServerSupabaseClient()).rpc('add_customer_vehicle',{p_customer_id:customerId,p_vehicle:vehiclePayload(form)});if(error)return resultError(error);revalidatePath(`/customers/${customerId}`);return {ok:true,customerId,customerNumber:data?.vehicle_id};}
export async function updateVehicleAction(vehicleId:string,customerId:string,form:FormData):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.manage_vehicles'))return {ok:false,error:'You do not have permission to manage vehicles.'};const {error}=await(await createServerSupabaseClient()).rpc('update_customer_vehicle',{p_vehicle_id:vehicleId,p_vehicle:vehiclePayload(form)});if(error)return resultError(error);revalidatePath(`/customers/${customerId}`);return {ok:true,customerId};}
export async function archiveVehicleAction(customerId:string,vehicleId:string):Promise<CustomerActionState>{const access=await getCurrentAccess();if(!hasPermission(access,'customers.manage_vehicles'))return {ok:false,error:'You do not have permission to manage vehicles.'};const {error}=await(await createServerSupabaseClient()).rpc('archive_customer_vehicle',{p_vehicle_id:vehicleId});if(error)return resultError(error);revalidatePath(`/customers/${customerId}`);return {ok:true,customerId};}
export async function setCustomerActiveFormAction(id:string,active:boolean,_formData:FormData):Promise<void>{const result=await setCustomerActiveAction(id,active);if(!result.ok)throw new Error(result.error);}
export async function archiveContactFormAction(customerId:string,contactId:string,_formData:FormData):Promise<void>{const result=await archiveContactAction(customerId,contactId);if(!result.ok)throw new Error(result.error);}
export async function archiveVehicleFormAction(customerId:string,vehicleId:string,_formData:FormData):Promise<void>{const result=await archiveVehicleAction(customerId,vehicleId);if(!result.ok)throw new Error(result.error);}
