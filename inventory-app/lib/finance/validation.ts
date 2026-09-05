import { z } from 'zod';

/**
 * Strict finance-settings input boundary for Phase 4A.
 *
 * These schemas mirror `update_finance_settings` in
 * `20260905183500_phase_4a_invoice_revisions_settings_discounts.sql`: only
 * non-secret identity fields are accepted, unknown keys (including provider
 * activation flags and any credential) are rejected, and every field supports an
 * explicit unconfigured/null state. The database repeats every check.
 */

const MAX_TEXT = 2000;

/** Optional, nullable, trimmed free-text field. */
const nullableText = z
  .union([z.string().trim().max(MAX_TEXT), z.null()])
  .optional();

/** Absolute paths, `..` traversal and URL-style values are never valid logo paths. */
const UNSAFE_LOGO_PATH = /(^\/|(^|\/)\.\.(\/|$)|:\/\/)/;

const logoAssetPath = z
  .union([
    z
      .string()
      .trim()
      .max(MAX_TEXT)
      .refine((value) => value === '' || !UNSAFE_LOGO_PATH.test(value), {
        message: 'Logo path must be a repository-relative asset path.',
      }),
    z.null(),
  ])
  .optional();

const abn = z
  .union([z.string().trim().regex(/^[0-9]{11}$/, 'ABN must be 11 digits.'), z.null()])
  .optional();

const sha256 = z
  .union([z.string().trim().regex(/^[a-f0-9]{64}$/), z.null()])
  .optional();

const emailField = z
  .union([z.string().trim().pipe(z.email()), z.null()])
  .optional();

const AddressSchema = z
  .union([
    z.strictObject({
      street_address: nullableText,
      suburb: nullableText,
      state: nullableText,
      postcode: nullableText,
      country: nullableText,
    }),
    z.null(),
  ])
  .optional();

const BankInstructionsSchema = z
  .union([
    z.strictObject({
      bank_name: nullableText,
      account_name: nullableText,
      bsb: nullableText,
      account_number: nullableText,
      payment_reference: nullableText,
      instructions: nullableText,
    }),
    z.null(),
  ])
  .optional();

export const GlobalFinanceSettingsSchema = z.strictObject({
  business_name: nullableText,
  abn,
  address: AddressSchema,
  phone: nullableText,
  shared_email: emailField,
  logo_asset_path: logoAssetPath,
  logo_sha256: sha256,
  bank_instructions: BankInstructionsSchema,
  invoice_footer: nullableText,
});

export const BranchFinanceSettingsSchema = z.strictObject({
  branch_name: nullableText,
  address: AddressSchema,
  phone: nullableText,
  contact_email: emailField,
  document_footer: nullableText,
});

export type GlobalFinanceSettingsInput = z.infer<typeof GlobalFinanceSettingsSchema>;
export type BranchFinanceSettingsInput = z.infer<typeof BranchFinanceSettingsSchema>;

/** Discipline check: neither schema may ever accept a provider/secret key. */
export const FORBIDDEN_FINANCE_SETTING_KEYS = [
  'stripe_enabled',
  'email_automation_enabled',
  'reminders_enabled',
  'stripe_secret_key',
  'stripe_webhook_secret',
  'resend_api_key',
  'cron_secret',
  'service_role_key',
  'database_password',
] as const;
