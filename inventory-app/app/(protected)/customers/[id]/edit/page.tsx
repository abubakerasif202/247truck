import { redirect, notFound } from 'next/navigation';
import { CustomerForm } from '@/components/customers/customer-form';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCustomer } from '@/lib/customers/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { updateCustomerAction } from '../../actions';

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) { const access = await getCurrentAccess(); if (!hasPermission(access, 'customers.edit')) redirect('/customers'); const { id } = await params; let customer; try { customer = await getCustomer(await createServerSupabaseClient(), id); } catch { notFound(); } return <div className="operations-page domain-customers max-w-4xl"><PageHeader domain="customers" title={`Edit ${customer.display_name}`} subtitle={customer.customer_number} /><CustomerForm customer={customer} action={updateCustomerAction.bind(null, id, customer.version)} /></div>; }
