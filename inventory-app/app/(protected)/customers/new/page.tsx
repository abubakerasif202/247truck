import { redirect } from 'next/navigation';
import { CustomerForm } from '@/components/customers/customer-form';
import { PageHeader } from '@/components/ui/page-header';
import { createCustomerAction } from '../actions';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { randomUUID } from 'node:crypto';

export default async function NewCustomerPage() { const access = await getCurrentAccess(); if (!hasPermission(access, 'customers.create')) redirect('/customers'); return <div className="operations-page domain-customers max-w-4xl"><PageHeader domain="customers" title="New customer" subtitle="Create a global customer or fleet record" /><CustomerForm action={createCustomerAction} requestId={randomUUID()} /></div>; }
