import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create };
  },
}));

import { runAssistantChat } from '@/lib/ai/assistant';
import type { UserAccessContext } from '@/lib/auth/types';

function ctx(overrides: Partial<UserAccessContext> = {}) {
  const access: UserAccessContext = {
    userId: 'u1',
    role: 'manager',
    locationId: 'l-lon',
    locationCode: 'LON',
    permissions: new Set(['inventory.view', 'purchasing.view']),
    ...overrides,
  } as UserAccessContext;
  return { supabase: {} as never, access, scope: { kind: 'location' as const, code: 'LON' as const } };
}

function textResponse(text: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'resp_1',
    output_text: text,
    output: [],
    usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 150 },
    ...overrides,
  };
}

describe('runAssistantChat', () => {
  beforeEach(() => {
    create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a disabled result without calling OpenAI when the feature flag is off', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', '');
    const result = await runAssistantChat('What should I reorder?', [], ctx());
    expect(result).toMatchObject({ ok: false, reason: 'disabled' });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns a missing_key result without calling OpenAI when no API key is configured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', '');
    const result = await runAssistantChat('What should I reorder?', [], ctx());
    expect(result).toMatchObject({ ok: false, reason: 'missing_key' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an empty message before calling OpenAI', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const result = await runAssistantChat('   ', [], ctx());
    expect(result).toMatchObject({ ok: false, reason: 'empty_message' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an over-length message before calling OpenAI', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const result = await runAssistantChat('a'.repeat(3000), [], ctx());
    expect(result).toMatchObject({ ok: false, reason: 'message_too_long' });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns a direct text answer with usage totals when the model needs no tools', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    create.mockResolvedValueOnce(textResponse('You have 42 products active.'));

    const result = await runAssistantChat('How many active products?', [], ctx());
    expect(result).toMatchObject({
      ok: true,
      reply: 'You have 42 products active.',
      toolsUsed: [],
      usage: { inputTokens: 100, outputTokens: 50, estimatedCostUsd: expect.any(Number) },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('runs a tool call round-trip and returns the model\'s final answer', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');

    create
      .mockResolvedValueOnce({
        id: 'resp_1',
        output_text: '',
        output: [{ type: 'function_call', call_id: 'call_1', name: 'get_inventory_summary', arguments: '{}' }],
        usage: { input_tokens: 200, output_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 220 },
      })
      .mockResolvedValueOnce(textResponse('Based on live data, you have 42 products with 3 low-stock items.', { id: 'resp_2' }));

    const result = await runAssistantChat('How is stock looking?', [], ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.toolsUsed).toEqual(['get_inventory_summary']);
      expect(result.reply).toContain('42 products');
      // Usage accumulates across both round trips.
      expect(result.usage.inputTokens).toBe(300);
      expect(result.usage.outputTokens).toBe(70);
    }
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('stops after the configured max tool rounds instead of looping forever', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');

    // Always requests another tool call -- a runaway/recursive model. The
    // assistant must still terminate and answer with whatever text it has.
    create.mockResolvedValue({
      id: 'resp_loop',
      output_text: 'I could not fully resolve that.',
      output: [{ type: 'function_call', call_id: 'call_x', name: 'get_inventory_summary', arguments: '{}' }],
      usage: { input_tokens: 50, output_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 60 },
    });

    const result = await runAssistantChat('Loop forever please', [], ctx());
    expect(result.ok).toBe(true);
    // maxToolRounds is 4, so the loop makes at most 5 calls (rounds 0..4) before forcing a text answer.
    expect(create.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('reports a timeout distinctly from a generic upstream error', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    create.mockRejectedValueOnce(new Error('Request timed out'));

    const result = await runAssistantChat('Anything', [], ctx());
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('reports a generic upstream error for a non-timeout OpenAI failure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    create.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const result = await runAssistantChat('Anything', [], ctx());
    expect(result).toMatchObject({ ok: false, reason: 'upstream_error' });
  });
});
