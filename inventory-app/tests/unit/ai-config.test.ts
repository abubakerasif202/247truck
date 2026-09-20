import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAiConfig } from '@/lib/ai/config';

describe('getAiConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled when OPENAI_AI_ENABLED is unset', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', '');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(getAiConfig()).toEqual({ enabled: false, reason: 'disabled' });
  });

  it('is disabled in the test environment even when the flag and key are set, so suites never spend real tokens', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(getAiConfig()).toEqual({ enabled: false, reason: 'disabled' });
  });

  it('reports missing_key when enabled but no API key is configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(getAiConfig()).toEqual({ enabled: false, reason: 'missing_key' });
  });

  it('defaults the model to gpt-5.6-terra when OPENAI_MODEL is unset', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_MODEL', '');
    expect(getAiConfig()).toEqual({ enabled: true, apiKey: 'sk-test', model: 'gpt-5.6-terra' });
  });

  it('uses OPENAI_MODEL when explicitly configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAI_AI_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.6-luna');
    expect(getAiConfig()).toEqual({ enabled: true, apiKey: 'sk-test', model: 'gpt-5.6-luna' });
  });
});
