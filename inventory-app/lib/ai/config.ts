import 'server-only';

/** Default model when OPENAI_MODEL is unset. The one place this string
 * literal exists -- lib/ai/pricing.ts imports it too, rather than repeating
 * it, so the pricing table's key can never silently drift from this default. */
export const DEFAULT_MODEL = 'gpt-5.6-terra';

export type AiConfig =
  | { enabled: true; apiKey: string; model: string }
  | { enabled: false; reason: 'disabled' | 'missing_key' };

/**
 * Resolves whether Ask 24/7 may run. Mirrors the invoice-email
 * enabled/not_configured pattern (lib/email/invoice-email.ts): the ERP must
 * keep working with no OpenAI key, so every caller gets a typed "disabled"
 * result instead of a thrown error. NODE_ENV === 'test' is force-disabled so
 * unit/integration/E2E suites never depend on -- or accidentally spend -- a
 * real OpenAI key.
 */
export function getAiConfig(): AiConfig {
  const enabledFlag = process.env.OPENAI_AI_ENABLED === 'true' && process.env.NODE_ENV !== 'test';
  if (!enabledFlag) return { enabled: false, reason: 'disabled' };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { enabled: false, reason: 'missing_key' };

  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  return { enabled: true, apiKey, model };
}

/** Hard safety limits for a single Ask 24/7 request. Centralised so cost
 * controls can be tuned in one place without touching orchestration logic. */
export const AI_LIMITS = {
  /** Maximum characters accepted in one user message. */
  maxUserMessageChars: 2000,
  /** Maximum prior messages replayed as context (most recent kept). */
  maxHistoryMessages: 12,
  /** Maximum rows a single tool result may return to the model. */
  maxToolResultRows: 50,
  /** Maximum tool-call round trips per request before the assistant must answer. */
  maxToolRounds: 4,
  /** Output token cap passed to the Responses API. */
  maxOutputTokens: 900,
  /** Abort the whole request if it runs longer than this. */
  requestTimeoutMs: 30_000,
} as const;
