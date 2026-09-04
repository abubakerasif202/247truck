import { redirect, notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { VehicleForm } from '@/components/customers/mutation-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCustomer } from '@/lib/customers/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { addVehicleAction } from '../../../actions';

export default async function NewVehiclePage({ params }: { params: Promise<{ id: string }> }) { const access = await getCurrentAccess(); if (!hasPermission(access, 'customers.manage_vehicles')) redirect('/customers'); const { id } = await params; let customer; try { customer = await getCustomer(await createServerSupabaseClient(), id); } catch { notFound(); } return <div className="operations-page domain-customers max-w-4xl"><PageHeader domain="customers" title="Add vehicle" subtitle={`${customer.customer_number} · ${customer.display_name}`} /><VehicleForm action={addVehicleAction.bind(null, id)} /></div>; }
