'use strict';
const { OpenAIProvider, OpenAICompatibleProvider } = require('./openai');
const { AnthropicProvider } = require('./anthropic');
const { GeminiProvider } = require('./gemini');
const { DeepSeekProvider } = require('./deepseek');
const { OpenRouterProvider } = require('./openrouter');
const { LocalProvider } = require('./local');
const { PollinationsTextProvider } = require('./pollinations');
const { SupabaseOpenAIProvider } = require('./supabase-openai');
const { SupabaseXkiroProvider } = require('./supabase-xkiro');

const PROVIDER_CLASSES = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  deepseek: DeepSeekProvider,
  openrouter: OpenRouterProvider,
  local: LocalProvider,
  pollinations: PollinationsTextProvider,
  'supabase-openai': SupabaseOpenAIProvider,
  'supabase-xkiro': SupabaseXkiroProvider,
  'openai-compatible': OpenAICompatibleProvider,
};

function createProvider(config, apiKey) {
  const Cls = PROVIDER_CLASSES[config.type] || OpenAICompatibleProvider;
  return new Cls(config, apiKey);
}

module.exports = { createProvider, PROVIDER_CLASSES };
