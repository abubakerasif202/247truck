import { redirect, notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { VehicleForm } from '@/components/customers/mutation-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCustomer } from '@/lib/customers/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { updateVehicleAction } from '../../../../actions';

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string; vehicleId: string }> }) { const access = await getCurrentAccess(); if (!hasPermission(access, 'customers.manage_vehicles')) redirect('/customers'); const { id, vehicleId } = await params; let customer; try { customer = await getCustomer(await createServerSupabaseClient(), id); } catch { notFound(); } const vehicle = customer.vehicles.find(row => row.id === vehicleId); if (!vehicle) notFound(); return <div className="operations-page domain-customers max-w-4xl"><PageHeader domain="customers" title="Edit vehicle" subtitle={`${customer.customer_number} · ${vehicle.registration}`} /><VehicleForm vehicle={vehicle} action={updateVehicleAction.bind(null, vehicleId, id)} /></div>; }
