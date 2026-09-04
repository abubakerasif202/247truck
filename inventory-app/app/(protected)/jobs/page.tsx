import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
export default async function JobsPage() { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.view')) return <div className="operations-page"><PageHeader title="Jobs" subtitle="Permission denied" /></div>; return <div className="operations-page max-w-6xl"><PageHeader title="Workshop jobs" subtitle="Open, schedule and complete workshop work" actions={hasPermission(access, 'jobs.create') ? <Link href="/jobs/new" className="flex h-10 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground">New job</Link> : null} /><div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">Use New job or Workshop POS to start a job. Job search and status board are next in the Phase 3B interface slice.</div></div>; }

