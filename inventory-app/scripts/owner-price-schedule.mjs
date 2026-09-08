import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { allRows, classifyOwnerRow, parseSchedule, uniqueMap } from './owner-price-schedule-core.mjs';

const EXPECTED_PROJECT_REF = 'afefdlvepdbtaxoscwew';
const EXPECTED_LOCAL_PROJECT_REF = '247truck-inventory';
const EXPECTED_SOURCE_ROWS = 28;
const EXPECTED_REFERENCE_QUANTITY = 643n;
const EXPECTED_SOURCE_SHA256 = 'F7F9EDE7F19AD5AC41884D91B792911078C1BD622BFBF100D387F0650C2FAD8A';
const SCHEDULE = new URL('../data/owner-price-schedule-2026-09-08.csv', import.meta.url);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing --${name}=...; a durable report path is required`);
  return value;
}

const target = argument('target');
if (!target || !['production', 'local'].includes(target)) throw new Error('Refusing reconciliation: pass --target=production or --target=local');
if (process.argv.includes('--apply')) throw new Error('Apply mode is intentionally unavailable; obtain separate approval for a server-side versioned pricing workflow.');
const outputPath = requiredArgument('output');

const sourceText = await readFile(SCHEDULE, 'utf8');
const sourceSha256 = createHash('sha256').update(sourceText, 'utf8').digest('hex').toUpperCase();
if (sourceSha256 !== EXPECTED_SOURCE_SHA256) throw new Error(`Owner schedule checksum mismatch: ${sourceSha256}`);
const { rows, referenceQuantity } = parseSchedule(sourceText, { headers: ['brand', 'pattern', 'size', 'source_quantity_text', 'quantity', 'selling_price_aud', 'source_reference'], rows: EXPECTED_SOURCE_ROWS, referenceQuantity: EXPECTED_REFERENCE_QUANTITY });

const url = required('SUPABASE_OWNER_PRICE_URL');
const parsedUrl = new URL(url);
const expectedRef = target === 'production' ? EXPECTED_PROJECT_REF : EXPECTED_LOCAL_PROJECT_REF;
if (target === 'production' && parsedUrl.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`) throw new Error('Refusing non-inventory production project URL');
if (target === 'local' && !['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) throw new Error('Refusing non-local URL for local reconciliation');
if (process.env.SUPABASE_OWNER_PRICE_PROJECT_REF !== expectedRef) throw new Error(`Project ref must be explicitly set to ${expectedRef}`);

const anonKey = required('SUPABASE_OWNER_PRICE_ANON_KEY');
const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const email = required('SUPABASE_OWNER_PRICE_READ_EMAIL');
const password = required('SUPABASE_OWNER_PRICE_READ_PASSWORD');
const login = await client.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;

const [brands, patterns, sizes, products] = await Promise.all([
  allRows(client, 'tyre_brands', 'id,display_name'),
  allRows(client, 'tyre_patterns', 'id,brand_id,display_name'),
  allRows(client, 'tyre_sizes', 'id,display_size'),
  allRows(client, 'products', 'id,part_reference,name,selling_price_incl_gst,active,tyre_condition,category_code,tyre_brand_id,tyre_pattern_id,tyre_size_id'),
]);
const brandByName = uniqueMap(brands.map((row) => [row.display_name.trim().toLowerCase(), row.id]), 'brand');
const patternByIdentity = uniqueMap(patterns.map((row) => [`${row.brand_id}|${row.display_name.trim().toLowerCase()}`, row.id]), 'pattern');
const sizeByName = uniqueMap(sizes.map((row) => [row.display_size.trim().toLowerCase(), row.id]), 'size');
const report = rows.map((row) => classifyOwnerRow(row, { brandByName, patternByIdentity, sizeByName }, products));
const audit = { batch_id: `owner-price-reconciliation-${sourceSha256.slice(0, 12)}-${target}`, completed_at: new Date().toISOString(), target, project_ref: expectedRef, source_rows: rows.length, reference_quantity: referenceQuantity.toString(), catalogue_rows: products.length, catalogue_complete: true, source_sha256: sourceSha256, products: report };
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(audit, null, 2));
