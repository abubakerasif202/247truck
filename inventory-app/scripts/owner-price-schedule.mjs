import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const SCHEDULE = new URL('../data/owner-price-schedule-2026-09-08.csv', import.meta.url);
const CONFIRMATION = 'OWNER-PRICE-2026-09-08';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function csv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value])));
}

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const mode = process.argv.includes('--apply') ? 'apply' : 'reconcile';
const target = arg('target') ?? 'production';
const url = env('SUPABASE_OWNER_PRICE_URL');
const serviceKey = env('SUPABASE_OWNER_PRICE_SERVICE_ROLE_KEY');
if (mode === 'apply' && arg('confirm') !== CONFIRMATION) {
  throw new Error(`Refusing apply: pass --confirm=${CONFIRMATION}`);
}
if (mode === 'apply' && target !== 'production' && target !== 'local') {
  throw new Error('Refusing apply: --target must be production or local');
}
if (mode === 'apply' && target === 'local' && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Refusing local apply against a non-local URL');
}
if (mode === 'apply' && target === 'production' && ['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Refusing production apply against a local URL');
}

const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const rows = csv(await readFile(SCHEDULE, 'utf8'));
const [brands, patterns, sizes, products] = await Promise.all([
  service.from('tyre_brands').select('id,display_name,normalized_name'),
  service.from('tyre_patterns').select('id,brand_id,display_name,normalized_name'),
  service.from('tyre_sizes').select('id,display_size,normalized_size'),
  service.from('products').select('id,part_reference,name,selling_price_incl_gst,tyre_condition,category_code,tyre_brand_id,tyre_pattern_id,tyre_size_id'),
]);
for (const result of [brands, patterns, sizes, products]) if (result.error) throw result.error;

const brandByName = new Map(brands.data.map((row) => [normalize(row.display_name ?? row.normalized_name), row.id]));
const patternByIdentity = new Map(patterns.data.map((row) => [`${row.brand_id}|${normalize(row.display_name ?? row.normalized_name)}`, row.id]));
const sizeByName = new Map(sizes.data.map((row) => [normalize(row.display_size ?? row.normalized_size), row.id]));
const resolved = rows.map((row) => {
  const brandId = brandByName.get(normalize(row.brand));
  const patternId = patternByIdentity.get(`${brandId}|${normalize(row.pattern)}`);
  const sizeId = sizeByName.get(normalize(row.size));
  const matches = products.data.filter((product) => product.category_code === 'truck_tyre'
    && product.tyre_condition === 'new' && product.tyre_brand_id === brandId
    && product.tyre_pattern_id === patternId && product.tyre_size_id === sizeId);
  if (matches.length !== 1) throw new Error(`Unresolved or ambiguous identity: ${row.brand}/${row.pattern}/${row.size} (${matches.length} matches)`);
  return { row, product: matches[0] };
});

console.log(JSON.stringify({
  target,
  mode,
  schedule_rows: rows.length,
  reference_tyres: rows.reduce((sum, row) => sum + Number(row.quantity), 0),
  products: resolved.map(({ row, product }) => ({
    product_id: product.id,
    sku: product.part_reference ?? null,
    identity: `${row.brand}/${row.pattern}/${row.size}`,
    current_selling_price_aud: product.selling_price_incl_gst,
    target_selling_price_aud: Number(row.selling_price_aud),
    reference_quantity: Number(row.quantity),
  })),
}, null, 2));

if (mode === 'apply') {
  const anonKey = env('SUPABASE_OWNER_PRICE_ANON_KEY');
  const email = env('SUPABASE_OWNER_PRICE_ADMIN_EMAIL');
  const password = env('SUPABASE_OWNER_PRICE_ADMIN_PASSWORD');
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  for (const { row, product } of resolved) {
    const result = await client.rpc('set_product_selling_price', {
      p_product_id: product.id,
      p_selling_price_incl_gst: Number(row.selling_price_aud),
    });
    if (result.error) throw result.error;
  }
  console.error(`Applied ${resolved.length} owner prices through set_product_selling_price.`);
}
