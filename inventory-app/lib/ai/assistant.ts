import 'server-only';

import type OpenAI from 'openai';

import { getAiConfig, AI_LIMITS } from './config';
import { getOpenAiClient } from './client';
import { buildSystemPrompt } from './system-prompt';
import { estimateCostUsd } from './pricing';
import { AI_TOOLS, runAiTool, type AiToolContext } from './tools';
import { describeLocationScope } from '@/lib/location/resolve-scope';

export type AiChatMessage = { role: 'user' | 'assistant'; content: string };

export type AiChatResult =
  | {
      ok: true;
      reply: string;
      model: string;
      toolsUsed: string[];
      usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; estimatedCostUsd: number };
    }
  | { ok: false; reason: 'disabled' | 'missing_key' | 'empty_message' | 'message_too_long' | 'upstream_error' | 'timeout'; message: string };

const RESPONSES_TOOLS: OpenAI.Responses.Tool[] = AI_TOOLS.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
  strict: false,
}));

function toolResultText(result: unknown): string {
  // Compact JSON, not pretty-printed -- this is model input, not a UI string.
  const json = JSON.stringify(result ?? null);
  // Defensive cap: a tool should already return AI_LIMITS.maxToolResultRows
  // rows, but this stops one oversized result from blowing the context.
  return json.length > 12_000 ? json.slice(0, 12_000) + '...(truncated)' : json;
}

/**
 * Runs one Ask 24/7 turn: enabled/config checks, input limits, the
 * tool-calling loop (bounded by AI_LIMITS.maxToolRounds), and usage
 * estimation. Never calls the OpenAI API with more than AI_LIMITS allows.
 * The caller (the API route) is responsible for persisting usage via
 * log_ai_usage and for the user's own permission/location context in `ctx`.
 */
export async function runAssistantChat(
  message: string,
  history: AiChatMessage[],
  ctx: AiToolContext,
): Promise<AiChatResult> {
  const config = getAiConfig();
  if (!config.enabled) {
    return {
      ok: false,
      reason: config.reason,
      message: config.reason === 'missing_key'
        ? 'Ask 24/7 is not configured yet -- an administrator needs to add an OpenAI API key.'
        : 'Ask 24/7 is currently disabled.',
    };
  }

  const trimmed = message.trim();
  if (!trimmed) return { ok: false, reason: 'empty_message', message: 'Type a question first.' };
  if (trimmed.length > AI_LIMITS.maxUserMessageChars) {
    return { ok: false, reason: 'message_too_long', message: `Questions are limited to ${AI_LIMITS.maxUserMessageChars} characters.` };
  }

  const client = getOpenAiClient(config.apiKey);
  const scopeLabel = describeLocationScope(ctx.scope);
  const recentHistory = history.slice(-AI_LIMITS.maxHistoryMessages);

  const input: OpenAI.Responses.ResponseInput = [
    ...recentHistory.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Responses.EasyInputMessage),
    { role: 'user', content: trimmed },
  ];

  const toolsUsed = new Set<string>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let previousResponseId: string | undefined;
  let currentInput: OpenAI.Responses.ResponseInputItem[] = input;

  try {
    for (let round = 0; round <= AI_LIMITS.maxToolRounds; round += 1) {
      const response = await client.responses.create({
        model: config.model,
        instructions: buildSystemPrompt(scopeLabel),
        input: currentInput,
        tools: RESPONSES_TOOLS,
        max_output_tokens: AI_LIMITS.maxOutputTokens,
        previous_response_id: previousResponseId,
      });

      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;
      totalCachedTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
      previousResponseId = response.id;

      const functionCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
      );

      if (functionCalls.length === 0 || round === AI_LIMITS.maxToolRounds) {
        const reply = response.output_text?.trim();
        return {
          ok: true,
          reply: reply || 'I was not able to put together an answer for that. Try rephrasing the question.',
          model: config.model,
          toolsUsed: [...toolsUsed],
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            cachedInputTokens: totalCachedTokens,
            estimatedCostUsd: estimateCostUsd(config.model, {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cachedInputTokens: totalCachedTokens,
            }),
          },
        };
      }

      const outputs: OpenAI.Responses.ResponseInputItem[] = [];
      for (const call of functionCalls) {
        toolsUsed.add(call.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          // Malformed tool-call arguments from the model -- fail that one
          // call closed rather than throwing the whole turn away.
        }
        const result = await runAiTool(call.name, args, ctx);
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: toolResultText(result) });
      }
      currentInput = outputs;
    }

    // Unreachable given the loop bound above, but keeps the function total.
    return { ok: false, reason: 'upstream_error', message: 'Ask 24/7 could not finish answering that question.' };
  } catch (error) {
    const isTimeout = error instanceof Error && /timeout|timed out/i.test(error.message);
    console.error('[ai] assistant chat failed', error instanceof Error ? error.message : error);
    return {
      ok: false,
      reason: isTimeout ? 'timeout' : 'upstream_error',
      message: isTimeout
        ? 'Ask 24/7 took too long to respond. Try again in a moment.'
        : 'Ask 24/7 is temporarily unavailable. Try again in a moment.',
    };
  }
}
