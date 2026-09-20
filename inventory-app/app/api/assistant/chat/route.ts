import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { runAssistantChat, type AiChatMessage } from '@/lib/ai/assistant';
import { AI_LIMITS } from '@/lib/ai/config';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(AI_LIMITS.maxUserMessageChars * 2),
});

const requestSchema = z.object({
  message: z.string().min(1).max(AI_LIMITS.maxUserMessageChars),
  history: z.array(messageSchema).max(AI_LIMITS.maxHistoryMessages).optional(),
});

/**
 * Server-side-only boundary for Ask 24/7. The OpenAI client and API key
 * never leave this route: the browser only ever sees the assistant's reply
 * text, tool names used, and usage totals.
 */
export async function POST(request: Request) {
  const access = await getCurrentAccess();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();
  const history: AiChatMessage[] = parsed.data.history ?? [];

  const startedAt = Date.now();
  const result = await runAssistantChat(parsed.data.message, history, { supabase, access, scope });
  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    if (result.reason === 'disabled' || result.reason === 'missing_key') {
      return NextResponse.json({ ok: false, reason: result.reason, message: result.message }, { status: 200 });
    }
    return NextResponse.json({ ok: false, reason: result.reason, message: result.message }, { status: 502 });
  }

  // Usage logging is best-effort telemetry -- a logging failure (including a
  // network-level rejection, not just a returned {error}) must never fail
  // the chat response the user is already waiting on.
  try {
    const { error } = await supabase.rpc('log_ai_usage', {
      p_model: result.model,
      p_input_tokens: result.usage.inputTokens,
      p_output_tokens: result.usage.outputTokens,
      p_cached_input_tokens: result.usage.cachedInputTokens || null,
      p_estimated_cost_usd: result.usage.estimatedCostUsd,
      p_tool_names: result.toolsUsed,
      p_duration_ms: durationMs,
      p_success: true,
      p_error_code: null,
    });
    if (error) console.error('[assistant] usage log failed', error.message);
  } catch (error) {
    console.error('[assistant] usage log threw', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({
    ok: true,
    reply: result.reply,
    toolsUsed: result.toolsUsed,
    usage: result.usage,
  });
}
