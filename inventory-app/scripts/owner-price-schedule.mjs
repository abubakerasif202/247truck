import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

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

function exactText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function decimalCents(value) {
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function csv(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const headers = lines.shift()?.split(',');
  const expectedHeaders = ['brand', 'pattern', 'size', 'source_quantity_text', 'quantity', 'selling_price_aud', 'source_reference'];
  if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) throw new Error('Owner schedule header mismatch');
  return lines.map((line, index) => {
    const values = line.split(',');
    if (values.length !== headers.length) throw new Error(`Owner schedule row ${index + 2} has invalid column count`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

async function allRows(client, table, columns) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < pageSize) return rows;
  }
}

const target = argument('target');
if (!target || !['production', 'local'].includes(target)) throw new Error('Refusing reconciliation: pass --target=production or --target=local');
if (process.argv.includes('--apply')) throw new Error('Apply mode is intentionally unavailable; obtain separate approval for a server-side versioned pricing workflow.');

const sourceText = await readFile(SCHEDULE, 'utf8');
const sourceSha256 = createHash('sha256').update(sourceText, 'utf8').digest('hex').toUpperCase();
if (sourceSha256 !== EXPECTED_SOURCE_SHA256) throw new Error(`Owner schedule checksum mismatch: ${sourceSha256}`);
const rows = csv(sourceText);
if (rows.length !== EXPECTED_SOURCE_ROWS) throw new Error(`Expected ${EXPECTED_SOURCE_ROWS} owner rows, found ${rows.length}`);
assertUnique(rows.map((row) => [exactText(row.brand), exactText(row.pattern), exactText(row.size)].join('|')), 'owner schedule identity');
let referenceQuantity = 0n;
for (const row of rows) {
  if (!/^\d+$/.test(row.source_quantity_text) || BigInt(row.source_quantity_text) !== BigInt(row.quantity)) throw new Error(`Quantity mismatch for ${row.brand}/${row.pattern}/${row.size}`);
  decimalCents(row.selling_price_aud);
  if (row.source_reference !== 'owner-supplied') throw new Error(`Unexpected source reference for ${row.brand}/${row.pattern}/${row.size}`);
  referenceQuantity += BigInt(row.quantity);
}
if (referenceQuantity !== EXPECTED_REFERENCE_QUANTITY) throw new Error(`Expected ${EXPECTED_REFERENCE_QUANTITY} reference tyres, found ${referenceQuantity}`);

const url = required('SUPABASE_OWNER_PRICE_URL');
const parsedUrl = new URL(url);
const expectedRef = target === 'production' ? EXPECTED_PROJECT_REF : EXPECTED_LOCAL_PROJECT_REF;
if (target === 'production' && parsedUrl.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`) throw new Error('Refusing non-inventory production project URL');
if (target === 'local' && !['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) throw new Error('Refusing non-local URL for local reconciliation');
if (process.env.SUPABASE_OWNER_PRICE_PROJECT_REF !== expectedRef) throw new Error(`Project ref must be explicitly set to ${expectedRef}`);

const anonKey = required('SUPABASE_OWNER_PRICE_ANON_KEY');
const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const email = process.env.SUPABASE_OWNER_PRICE_READ_EMAIL;
const password = process.env.SUPABASE_OWNER_PRICE_READ_PASSWORD;
if (email || password) {
  if (!email || !password) throw new Error('Read-only reconciliation credentials must be supplied together');
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
}

const [brands, patterns, sizes, products] = await Promise.all([
  allRows(client, 'tyre_brands', 'id,display_name'),
  allRows(client, 'tyre_patterns', 'id,brand_id,display_name'),
  allRows(client, 'tyre_sizes', 'id,display_size'),
  allRows(client, 'products', 'id,part_reference,name,selling_price_incl_gst,active,tyre_condition,category_code,tyre_brand_id,tyre_pattern_id,tyre_size_id'),
]);
const uniqueMap = (values, label) => {
  const map = new Map();
  for (const [key, value] of values) {
    if (map.has(key)) throw new Error(`Ambiguous ${label}: ${key}`);
    map.set(key, value);
  }
  return map;
};
const brandByName = uniqueMap(brands.map((row) => [exactText(row.display_name), row.id]), 'brand');
const patternByIdentity = uniqueMap(patterns.map((row) => [`${row.brand_id}|${exactText(row.display_name)}`, row.id]), 'pattern');
const sizeByName = uniqueMap(sizes.map((row) => [exactText(row.display_size), row.id]), 'size');
const report = rows.map((row) => {
  const brandId = brandByName.get(exactText(row.brand));
  const patternId = patternByIdentity.get(`${brandId}|${exactText(row.pattern)}`);
  const sizeId = sizeByName.get(exactText(row.size));
  const matches = products.filter((product) => product.tyre_brand_id === brandId && product.tyre_pattern_id === patternId && product.tyre_size_id === sizeId);
  const approved = matches.filter((product) => product.active && product.category_code === 'truck_tyre' && product.tyre_condition === 'new');
  let status = 'already matching';
  if (matches.length === 0) status = 'missing product';
  else if (matches.length !== 1 || approved.length !== 1) status = matches.length > 1 ? 'ambiguous identity' : 'inactive/unapproved product';
  else if (decimalCents(matches[0].selling_price_incl_gst) !== decimalCents(row.selling_price_aud)) status = 'price different';
  const product = approved.length === 1 ? approved[0] : matches[0] ?? null;
  return { product_id: product?.id ?? null, sku: product?.part_reference ?? null, brand: row.brand, pattern: row.pattern, size: row.size, current_selling_price: product?.selling_price_incl_gst ?? null, target_selling_price: row.selling_price_aud, reference_quantity: row.quantity, match_status: status };
});
console.log(JSON.stringify({ target, project_ref: expectedRef, source_rows: rows.length, reference_quantity: referenceQuantity.toString(), catalogue_rows: products.length, catalogue_complete: true, source_sha256: sourceSha256, products: report }, null, 2));
