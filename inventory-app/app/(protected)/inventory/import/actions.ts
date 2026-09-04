'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentAccess } from '@/lib/auth/access';
import { recordAuditEvent } from '@/lib/auth/audit';
import {
  importOpeningStockDataset,
  type OpeningStockImportReport,
} from '@/lib/opening-stock/repository';
import { loadOpeningStockSource } from '@/lib/opening-stock/source';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type OpeningStockImportActionState = {
  ok: boolean;
  error?: string;
  report?: OpeningStockImportReport;
};

export async function runOpeningStockImportAction(
  _previous: OpeningStockImportActionState | undefined,
  _formData: FormData,
): Promise<OpeningStockImportActionState> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can make opening stock live.' };
  }

  let source;
  try {
    // Never trust browser-supplied rows. Re-read and re-validate the committed
    // source at action time before any database mutation is attempted.
    source = await loadOpeningStockSource();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Opening stock source validation failed.',
    };
  }

  const supabase = await createServerSupabaseClient();
  let report: OpeningStockImportReport;
  try {
    report = await importOpeningStockDataset(supabase, source);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Opening stock import failed.',
    };
  }

  revalidatePath('/dashboard');
  revalidatePath('/inventory');
  revalidatePath('/inventory/import');

  if (report.errors.length > 0) {
    return {
      ok: false,
      error: `${report.errors.length} opening-stock row(s) failed. Successful rows are idempotent and a retry is safe.`,
      report,
    };
  }

  const audit = await recordAuditEvent(
    {
      eventType: 'OPENING_STOCK_IMPORT_COMPLETED',
      entityType: 'opening_stock_import',
      entityId: source.sha256,
      details: {
        datasetKey: source.datasetKey,
        sha256: source.sha256,
        sourceRows: report.sourceRows,
        sourceQuantity: report.sourceQuantity,
        createdProducts: report.createdProducts,
        matchedProducts: report.matchedProducts,
        postedRows: report.postedRows,
        postedQuantity: report.postedQuantity,
        replayedRows: report.replayedRows,
      },
    },
    supabase,
  );

  if (!audit.ok) {
    return {
      ok: false,
      error: 'Stock was imported, but the completion audit event failed. The import is safe to retry.',
      report,
    };
  }

  return { ok: true, report };
}
