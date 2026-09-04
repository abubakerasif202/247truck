import { redirect } from 'next/navigation';

import { OpeningStockImportPanel } from '@/components/inventory/opening-stock-import-panel';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
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
        title="Opening Stock Import"
        subtitle="Preview the fixed Regency Park source before posting any live inventory."
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
