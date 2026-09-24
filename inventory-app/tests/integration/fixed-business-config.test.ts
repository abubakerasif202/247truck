import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
const run = ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55331' ? describe : describe.skip;

function sql(query: string): string {
  const url = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

run('fixed business configuration', () => {
  it('uses full business names for the existing REG and LON location records', () => {
    const locations = JSON.parse(sql("select jsonb_object_agg(code,name) from public.locations where code in ('REG','LON')"));
    expect(locations).toEqual({ REG: '24/7 Truck Tyre Services', LON: 'Adelaide Wholesale Tyres' });
  });

  it('denies the retired settings update RPCs to authenticated users', () => {
    expect(sql("select has_function_privilege('authenticated','public.update_finance_settings(uuid,integer,uuid,jsonb)','execute')")).toBe('f');
    expect(sql("select has_function_privilege('authenticated','public.update_invoice_brand_settings(text,integer,jsonb)','execute')")).toBe('f');
  });

  it('resolves both issuer snapshots from fixed values', () => {
    const details = JSON.parse(sql("select jsonb_build_object('truck',private.document_business_config('247'),'awt',private.document_business_config('awt'))"));
    expect(details.truck).toMatchObject({ business_name: '24/7 Truck Tyre Services', legal_name: 'AGGY TEK PTY LTD', abn: '85640190996', bank_instructions: { bsb: '065122', account_number: '11293981' } });
    expect(details.awt).toMatchObject({ business_name: 'Adelaide Wholesale Tyres', abn: '47690275588', bank_instructions: { bsb: '065122', account_number: '11293981' } });
    expect(details.truck.logo_asset_path).toBe('/brand/logo-247-invoice-2026.png');
    expect(details.awt.logo_asset_path).toBe('/invoice-templates/awt-logo.png');
    expect(details.truck.shared_email).not.toBe(details.awt.shared_email);
  });

  it('uses the fixed issuance function and disables legacy synchronization', () => {
    expect(sql("select count(*) from pg_proc where oid='private.finance_issue_snapshots(uuid)'::regprocedure")).toBe('1');
    expect(sql("select count(*) from pg_trigger where tgname='finance_settings_sync_247_brand' and not tgisinternal")).toBe('0');
  });
});
