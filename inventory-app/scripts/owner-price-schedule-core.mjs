export function exactText(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function decimalCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function parseSchedule(text, expected) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const headers = lines.shift()?.split(',');
  if (JSON.stringify(headers) !== JSON.stringify(expected.headers)) throw new Error('Owner schedule header mismatch');
  const rows = lines.map((line, index) => {
    const values = line.split(',');
    if (values.length !== headers.length) throw new Error(`Owner schedule row ${index + 2} has invalid column count`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
  if (rows.length !== expected.rows) throw new Error(`Expected ${expected.rows} owner rows, found ${rows.length}`);
  const seen = new Set();
  let referenceQuantity = 0n;
  for (const row of rows) {
    const identity = [exactText(row.brand), exactText(row.pattern), exactText(row.size)].join('|');
    if (seen.has(identity)) throw new Error(`Duplicate owner schedule identity: ${identity}`);
    seen.add(identity);
    if (!/^\d+$/.test(row.source_quantity_text) || BigInt(row.source_quantity_text) !== BigInt(row.quantity)) throw new Error(`Quantity mismatch for ${row.brand}/${row.pattern}/${row.size}`);
    decimalCents(row.selling_price_aud);
    if (row.source_reference !== 'owner-supplied') throw new Error(`Unexpected source reference for ${row.brand}/${row.pattern}/${row.size}`);
    referenceQuantity += BigInt(row.quantity);
  }
  if (referenceQuantity !== expected.referenceQuantity) throw new Error(`Expected ${expected.referenceQuantity} reference tyres, found ${referenceQuantity}`);
  return { rows, referenceQuantity };
}

export async function allRows(client, table, columns, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function uniqueMap(values, label) {
  const map = new Map();
  for (const [key, value] of values) {
    if (map.has(key)) throw new Error(`Ambiguous ${label}: ${key}`);
    map.set(key, value);
  }
  return map;
}

export function classifyOwnerRow(row, maps, products) {
  const brandId = maps.brandByName.get(exactText(row.brand));
  const patternId = maps.patternByIdentity.get(`${brandId}|${exactText(row.pattern)}`);
  const sizeId = maps.sizeByName.get(exactText(row.size));
  const matches = products.filter((product) => product.tyre_brand_id === brandId && product.tyre_pattern_id === patternId && product.tyre_size_id === sizeId);
  const approved = matches.filter((product) => product.active && product.category_code === 'truck_tyre' && product.tyre_condition === 'new');
  let status = 'already matching';
  if (matches.length === 0) status = 'missing product';
  else if (matches.length !== 1 || approved.length !== 1) status = matches.length > 1 ? 'ambiguous identity' : 'inactive/unapproved product';
  else if (decimalCents(matches[0].selling_price_incl_gst) === null) status = 'price missing';
  else if (decimalCents(matches[0].selling_price_incl_gst) !== decimalCents(row.selling_price_aud)) status = 'price different';
  const product = approved.length === 1 ? approved[0] : matches[0] ?? null;
  return { product_id: product?.id ?? null, sku: product?.part_reference ?? null, brand: row.brand, pattern: row.pattern, size: row.size, current_selling_price: product?.selling_price_incl_gst ?? null, target_selling_price: row.selling_price_aud, reference_quantity: row.quantity, match_status: status };
}
