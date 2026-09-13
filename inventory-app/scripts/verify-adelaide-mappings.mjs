import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_TEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(JSON.stringify({ status: 'error', code: 'SUPABASE_ENV_MISSING' }));
  process.exit(2);
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [{ data: catalogue, error: catalogueError }, { data: discrepancies, error: reconciliationError }] = await Promise.all([
  client.from('adelaide_website_products').select('website_product_id,active,sellable'),
  client.rpc('adelaide_integration_reconciliation'),
]);
if (catalogueError || reconciliationError) {
  console.error(JSON.stringify({ status: 'error', code: 'MAPPING_VALIDATION_QUERY_FAILED' }));
  process.exit(2);
}

const activeSellable = (catalogue ?? []).filter((row) => row.active && row.sellable);
const failures = (discrepancies ?? []).filter((row) => row.discrepancy_type === 'product_mapping_invalid');
const report = {
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? 'pass' : 'fail',
  activeSellableProducts: activeSellable.length,
  mappedProducts: activeSellable.length - failures.length,
  unmappedOrInvalidProducts: failures.length,
  failures: failures.map((row) => ({
    websiteProductId: row.external_order_reference,
    mappingId: row.mapping_id,
    inventoryProductId: row.inventory_product_id,
    severity: row.severity,
  })),
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  await mkdir(dirname(process.argv[outputIndex + 1]), { recursive: true });
  await writeFile(process.argv[outputIndex + 1], `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exit(1);
