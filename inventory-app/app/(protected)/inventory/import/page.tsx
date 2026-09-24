import { redirect } from 'next/navigation';

import { OpeningStockImportPanel } from '@/components/inventory/opening-stock-import-panel';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { LOCATION_NAMES } from '@/lib/app-config';
import { previewOpeningStockDataset } from '@/lib/opening-stock/repository';
import { loadOpeningStockSource } from '@/lib/opening-stock/source';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { runOpeningStockImportAction } from './actions';

export default async function OpeningStockImportPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') redirect('/inventory');

  const source = await loadOpeningStockSource();
  const supabase = await createServerSupabaseClient();
  const preview = await previewOpeningStockDataset(supabase, source);

  return (
    <div className="operations-page max-w-6xl domain-inventory">
      <PageHeader
        domain="inventory"
        eyebrow="Admin-only opening balance"
        title="Historical/Bulk Opening Stock Import"
        subtitle={`Admin-only historical import for the fixed 53-product, 725-tyre ${LOCATION_NAMES.REG} source. Use Add Opening Stock for day-to-day single-product entries.`}
      />
      <OpeningStockImportPanel
        preview={preview}
        sourceQuantity={source.totalQuantity}
        sha256={source.sha256}
        action={runOpeningStockImportAction}
      />
    </div>
  );
}
