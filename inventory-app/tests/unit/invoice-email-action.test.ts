import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentAccess = vi.fn();
const getInvoiceDetail = vi.fn();
const renderInvoicePdf = vi.fn();
const sendInvoiceEmail = vi.fn();
const revalidatePath = vi.fn();
const rpc = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

vi.mock('@/lib/auth/access', () => ({
  getCurrentAccess: (...args: unknown[]) => getCurrentAccess(...args),
}));

vi.mock('@/lib/finance/queries', () => ({
  getInvoiceDetail: (...args: unknown[]) => getInvoiceDetail(...args),
}));

vi.mock('@/lib/documents/render-invoice-pdf', () => ({
  renderInvoicePdf: (...args: unknown[]) => renderInvoicePdf(...args),
}));

vi.mock('@/lib/email/invoice-email', () => ({
  sendInvoiceEmail: (...args: unknown[]) => sendInvoiceEmail(...args),
  invoiceEmailSender: () => (process.env.INVOICE_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL || '').trim(),
  invoiceEmailPayloadSha256: () => 'a'.repeat(64),
  buildInvoiceEmailPayload: (input: unknown) => input,
  storeInvoiceEmailPayload: (payload: unknown) => payload,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ rpc })),
}));

import { sendInvoiceEmailAction } from '../../app/(protected)/invoices/actions';

const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

const adminAccess = { userId: 'admin-1', role: 'admin', locationId: null, locationCode: null, permissions: new Set() };

function detailFixture() {
  return {
    ok: true,
    data: {
      revisions: [{ id: REVISION_ID, lifecycle: 'issued' }],
    },
  };
}

function invoiceDocFixture() {
  return { status: 'issued', invoiceId: INVOICE_ID, revisionId: REVISION_ID };
}

function beginResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REQUEST_ID,
    idempotency_key: 'invoice-email/rev/1/key-1',
    state: 'pending',
    attempt_count: 1,
    send_sequence: 1,
    key_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    key_expired: false,
    reused: false,
    provider_payload: { idempotencyKey: 'invoice-email/rev/1/key-1' },
    ...overrides,
  };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentAccess.mockResolvedValue(adminAccess);
  getInvoiceDetail.mockResolvedValue(detailFixture());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

vi.mock('@/lib/documents/invoice-types', () => ({
  invoiceDocumentFromDetail: () => invoiceDocFixture(),
}));

describe('sendInvoiceEmailAction', () => {
  it('denies without permission and never calls any RPC', async () => {
    getCurrentAccess.mockResolvedValue({ userId: 'u1', role: 'staff', locationId: null, locationCode: null, permissions: new Set() });
    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('permission') });
    expect(rpc).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('passes mode "retry" to prepare_invoice_email_send and reuses the same idempotency key across two invocations', async () => {
    renderInvoicePdf.mockResolvedValue(Buffer.from('pdf'));
    const idempotencyKey = 'invoice-email/rev/1/stable-key';
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: beginResult({ idempotency_key: idempotencyKey }), error: null });
      if (fn === 'finish_invoice_email_send') return Promise.resolve({ data: {}, error: null });
      throw new Error(`unexpected rpc ${fn}`);
    });
    sendInvoiceEmail.mockResolvedValue({ outcome: 'accepted', providerMessageId: 'msg-1' });

    await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID, mode: 'retry' }));
    await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID, mode: 'retry' }));

    expect(rpc).toHaveBeenCalledWith('prepare_invoice_email_send', expect.objectContaining({ p_mode: 'retry' }));
    const calls = sendInvoiceEmail.mock.calls;
    expect(calls[0][0].idempotencyKey).toBe(idempotencyKey);
    expect(calls[1][0].idempotencyKey).toBe(idempotencyKey);
  });

  it('passes mode "resend" to prepare_invoice_email_send', async () => {
    renderInvoicePdf.mockResolvedValue(Buffer.from('pdf'));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: beginResult(), error: null });
      if (fn === 'finish_invoice_email_send') return Promise.resolve({ data: {}, error: null });
      throw new Error(`unexpected rpc ${fn}`);
    });
    sendInvoiceEmail.mockResolvedValue({ outcome: 'accepted', providerMessageId: 'msg-1' });

    await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID, mode: 'resend' }));

    expect(rpc).toHaveBeenCalledWith('prepare_invoice_email_send', expect.objectContaining({ p_mode: 'resend' }));
  });

  it('claims the persisted payload before a configured provider call', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    renderInvoicePdf.mockResolvedValue(Buffer.from('stable-pdf'));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: beginResult(), error: null });
      if (fn === 'finish_invoice_email_send') return Promise.resolve({ data: {}, error: null });
      throw new Error(`unexpected rpc ${fn}`);
    });
    sendInvoiceEmail.mockResolvedValue({ outcome: 'accepted', providerMessageId: 'msg-1' });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID }));

    expect(result.ok).toBe(true);
    const prepareOrder = rpc.mock.invocationCallOrder[rpc.mock.calls.findIndex((call) => call[0] === 'prepare_invoice_email_send')];
    expect(prepareOrder).toBeLessThan(sendInvoiceEmail.mock.invocationCallOrder[0]);
    expect(rpc).toHaveBeenCalledWith('prepare_invoice_email_send', expect.objectContaining({
      p_payload_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_claim_provider: true,
    }));
  });

  it('does not call the provider when another worker owns the send claim', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    renderInvoicePdf.mockResolvedValue(Buffer.from('stable-pdf'));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: null, error: { message: 'EMAIL_SEND_IN_PROGRESS' } });
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID, mode: 'retry' }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already in progress') });
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('requires reconciliation for a changed saved payload without calling the provider', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'changed-sender@example.test');
    renderInvoicePdf.mockResolvedValue(Buffer.from('changed-pdf'));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: null, error: { message: 'EMAIL_PAYLOAD_MISMATCH' } });
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID, mode: 'retry' }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('reconcile') });
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('records an uncertain outcome via finish_invoice_email_send and tells the user to retry', async () => {
    renderInvoicePdf.mockResolvedValue(Buffer.from('pdf'));
    rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: beginResult(), error: null });
      if (fn === 'finish_invoice_email_send') {
        expect(args.p_outcome).toBe('uncertain');
        return Promise.resolve({ data: {}, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    sendInvoiceEmail.mockResolvedValue({ outcome: 'uncertain', error: 'The provider did not confirm this send.' });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Retry send') });
    expect(rpc).toHaveBeenCalledWith('finish_invoice_email_send', expect.objectContaining({ p_outcome: 'uncertain' }));
  });

  it('reports a concurrent acceptance instead of a generic error when an uncertain finish hits EMAIL_ALREADY_ACCEPTED', async () => {
    renderInvoicePdf.mockResolvedValue(Buffer.from('pdf'));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: beginResult(), error: null });
      if (fn === 'finish_invoice_email_send') return Promise.resolve({ data: null, error: { code: '23505', message: 'EMAIL_ALREADY_ACCEPTED' } });
      throw new Error(`unexpected rpc ${fn}`);
    });
    sendInvoiceEmail.mockResolvedValue({ outcome: 'uncertain', error: 'concurrent' });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already accepted by the email provider') });
    expect(result).toMatchObject({ error: expect.stringContaining('Do not resend') });
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it('returns the "do not resend" error when finish fails after acceptance, without calling the provider twice', async () => {
    renderInvoicePdf.mockResolvedValue(Buffer.from('pdf'));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: beginResult(), error: null });
      if (fn === 'finish_invoice_email_send') return Promise.resolve({ data: null, error: { message: 'db unavailable' } });
      throw new Error(`unexpected rpc ${fn}`);
    });
    sendInvoiceEmail.mockResolvedValue({ outcome: 'accepted', providerMessageId: 'msg-1' });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Do not resend') });
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it('maps EMAIL_RETRY_WINDOW_EXPIRED to the 24-hour retry message', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: null, error: { message: 'EMAIL_RETRY_WINDOW_EXPIRED' } });
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID, mode: 'retry' }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('24 hours') });
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('maps EMAIL_ALREADY_ACCEPTED to a "use send again" message', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'prepare_invoice_email_send') return Promise.resolve({ data: null, error: { message: 'EMAIL_ALREADY_ACCEPTED' } });
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await sendInvoiceEmailAction(INVOICE_ID, undefined, form({ recipient: 'a@example.test', revision_id: REVISION_ID }));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Send again') });
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });
});
