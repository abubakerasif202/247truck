import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { listTransfers } from '@/lib/transfers/queries';
import type { TransferStatus } from '@/lib/transfers/types';

const statuses: Array<TransferStatus | undefined> = [undefined, 'requested', 'approved', 'in_transit', 'review_required', 'completed'];
const label = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, x => x.toUpperCase());

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.view')) redirect('/dashboard');
  const status = (await searchParams).status as TransferStatus | undefined;
  const transfers = await listTransfers(await createServerSupabaseClient(), statuses.includes(status) ? status : undefined);
  return <div className="grid gap-6">
    <PageHeader title="Stock transfers" subtitle="Move stock between Regency Park and Lonsdale with a complete audit trail." actions={hasPermission(access, 'inventory.transfer_request') ? <Link className={buttonVariants()} href="/transfers/new">New transfer</Link> : undefined} />
    <nav aria-label="Transfer status" className="flex flex-wrap gap-2">{statuses.map(s => <Link key={s ?? 'all'} className={buttonVariants({ variant: status === s ? 'default' : 'outline', size: 'sm' })} href={s ? `/transfers?status=${s}` : '/transfers'}>{s ? label(s) : 'All'}</Link>)}</nav>
    <div className="grid gap-3 md:hidden">{transfers.map(t => <Link key={t.id} href={`/transfers/${t.id}`} className="rounded-xl border bg-card p-4"><div className="flex justify-between gap-3"><strong>{t.transferNumber}</strong><StatusBadge status={t.status}>{label(t.status)}</StatusBadge></div><p className="mt-2 text-sm text-muted-foreground">{t.sourceCode} → {t.destinationCode}</p></Link>)}</div>
    <div className="hidden overflow-x-auto rounded-xl border md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-4">Transfer</th><th>Route</th><th>Status</th><th>Created</th></tr></thead><tbody>{transfers.map(t => <tr key={t.id} className="border-b last:border-0"><td className="p-4"><Link className="font-medium underline-offset-4 hover:underline" href={`/transfers/${t.id}`}>{t.transferNumber}</Link></td><td>{t.sourceCode} → {t.destinationCode}</td><td><StatusBadge status={t.status}>{label(t.status)}</StatusBadge></td><td>{new Date(t.createdAt).toLocaleDateString('en-AU')}</td></tr>)}</tbody></table></div>
    {transfers.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">No transfers match this filter.</p>}
  </div>;
}
