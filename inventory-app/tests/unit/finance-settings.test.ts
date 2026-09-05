import { describe, expect, it } from 'vitest';
import {
  GlobalFinanceSettingsSchema,
  BranchFinanceSettingsSchema,
  FORBIDDEN_FINANCE_SETTING_KEYS,
} from '../../lib/finance/validation';

describe('finance settings input boundary', () => {
  it('accepts an unconfigured identity without inventing values', () => {
    expect(GlobalFinanceSettingsSchema.safeParse({ business_name: null }).success).toBe(true);
    expect(GlobalFinanceSettingsSchema.safeParse({}).success).toBe(true);
    expect(
      GlobalFinanceSettingsSchema.safeParse({
        business_name: '24/7 Truck Tyre Services',
        abn: '12345678901',
        address: { street_address: '1 Depot Rd', suburb: 'Regency Park', state: 'SA', postcode: '5010', country: null },
        shared_email: 'accounts@example.com',
        logo_asset_path: 'assets/finance/logo.png',
        logo_sha256: 'a'.repeat(64),
        bank_instructions: { bank_name: 'Example', bsb: '000-000', account_number: '12345678', account_name: null, payment_reference: null, instructions: null },
      }).success,
    ).toBe(true);
  });

  it.each([
    { stripe_enabled: true },
    { email_automation_enabled: false },
    { reminders_enabled: true },
    { stripe_secret_key: 'not-a-secret' },
    { stripe_webhook_secret: 'x' },
    { resend_api_key: 'x' },
    { cron_secret: 'x' },
    { service_role_key: 'x' },
    { address: { secret: 'x' } },
    { bank_instructions: { routing: 'x' } },
    { abn: '123' },
    { abn: '1234567890a' },
    { shared_email: 'invalid' },
    { logo_asset_path: '/etc/passwd' },
    { logo_asset_path: '../secrets/logo.png' },
    { logo_asset_path: 'https://evil.example/logo.png' },
    { logo_sha256: 'nothex' },
  ])('rejects unsafe global settings %j', (input) => {
    expect(GlobalFinanceSettingsSchema.safeParse(input).success).toBe(false);
  });

  it('never lists a provider or secret key as an accepted field', () => {
    const globalShape = Object.keys(GlobalFinanceSettingsSchema.shape);
    const branchShape = Object.keys(BranchFinanceSettingsSchema.shape);
    for (const forbidden of FORBIDDEN_FINANCE_SETTING_KEYS) {
      expect(globalShape).not.toContain(forbidden);
      expect(branchShape).not.toContain(forbidden);
    }
  });

  it('keeps banking global and rejects branch-scoped provider fields', () => {
    expect(BranchFinanceSettingsSchema.safeParse({ bank_instructions: {} }).success).toBe(false);
    expect(BranchFinanceSettingsSchema.safeParse({ stripe_enabled: true }).success).toBe(false);
    expect(BranchFinanceSettingsSchema.safeParse({ shared_email: 'x@y.z' }).success).toBe(false);
    expect(
      BranchFinanceSettingsSchema.safeParse({ branch_name: 'Lonsdale', contact_email: 'lon@example.com', document_footer: null }).success,
    ).toBe(true);
  });
});
