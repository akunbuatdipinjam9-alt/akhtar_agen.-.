'use strict';
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require('../auth/supabase');
                                                                               

const DEFAULT_PROVIDERS = [
  { id: 'akhtar-xkiro', type: 'supabase-xkiro', label: 'xKiro · Semua Model Gratis (Supabase)', baseUrl: `${SUPABASE_URL}/functions/v1/xkiro-free`, publishableKey: SUPABASE_PUBLISHABLE_KEY, models: ['xkiro-free-auto', 'xkiro-free-light', 'xkiro-free-mid', 'xkiro-free-heavy'] },
  { id: 'akhtar-openai-router', type: 'supabase-openai', label: 'Akhtar Cloud · Auto Router', baseUrl: `${SUPABASE_URL}/functions/v1/openai-router`, publishableKey: SUPABASE_PUBLISHABLE_KEY, models: ['gpt-5-mini', 'gpt-6-luna'] },
  { id: 'akhtar-luna', type: 'supabase-openai', label: 'GPT-6 Luna · Akhtar Cloud (legacy URL)', baseUrl: `${SUPABASE_URL}/functions/v1/openai-luna`, publishableKey: SUPABASE_PUBLISHABLE_KEY, models: ['gpt-6-luna'] },
  { id: 'pollinations', type: 'pollinations', label: 'Pollinations (gratis, tanpa key)', baseUrl: 'https://text.pollinations.ai', models: ['openai'] },
  { id: 'openai', type: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
  { id: 'anthropic', type: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', models: [] },
  { id: 'gemini', type: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [] },
  { id: 'deepseek', type: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: [] },
  { id: 'openrouter', type: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: [] },
  { id: 'xai', type: 'openai-compatible', label: 'xAI', baseUrl: 'https://api.x.ai/v1', models: [] },
  { id: 'groq', type: 'openai-compatible', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: [] },
  { id: 'mistral', type: 'openai-compatible', label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', models: [] },
  { id: 'together', type: 'openai-compatible', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: [] },
  { id: 'cerebras', type: 'openai-compatible', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', models: [] },
  { id: 'local', type: 'local', label: 'Local (Ollama / LM Studio)', baseUrl: 'http://localhost:11434/v1', models: [] },
];

const DEFAULTS = {
  providers: DEFAULT_PROVIDERS,
  activeModel: { providerId: 'akhtar-xkiro', model: 'xkiro-free-auto' },
  routing: {
    auto: true,
    light: { providerId: 'akhtar-xkiro', model: 'xkiro-free-light' },
    mid: { providerId: 'akhtar-xkiro', model: 'xkiro-free-mid' },
    heavy: { providerId: 'akhtar-xkiro', model: 'xkiro-free-heavy' },
  },
  collaboration: { mode: 'auto', secondaryProviderId: '', secondaryModel: '', maxDelegations: 1 },
  agent: {
    defaultMode: 'assist',
    maxIterations: 25,
    runTimeoutMin: 20,
    toolTimeoutSec: 120,
    maxOutputTokens: 4096,
    temperature: 0.3,
    parallelTools: true,
    maxParallelTools: 3,
    parallelWorkers: true,
    maxParallelWorkers: 2,
    maxParallelWorkerBatches: 2,
    workerMaxOutputTokens: 2400,
  },
  context: { budgetChars: 60000, compression: true, recentMessages: 10, summaryChars: 12000, toolObservationChars: 900, extraBudgetChars: 30000, memoryChars: 3500, projectKnowledge: true, knowledgeResults: 6 },
  prayer: { method: 20 },
  islamicEvents: { enabled: false, consentGranted: false, mode: 'important', lastNotified: null },
  ui: { theme: 'dark' },
  computerControl: { osUrl: '' },
  mcp: { servers: [] },
  browserVision: { mode: 'smart', maxCallsPerTask: 3, providerId: '', model: '' },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, patch) {
  if (!isObj(patch)) return patch === undefined ? base : patch;
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  return out;
}

function mergeProviders(stored) {
  const list = Array.isArray(stored) ? stored : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const merged = DEFAULT_PROVIDERS.map((d) => ({ ...d, ...(byId.get(d.id) || {}), type: d.type }));
  for (const p of list) if (!DEFAULT_PROVIDERS.some((d) => d.id === p.id)) merged.push(p);
  return merged;
}

const clamp = (n, lo, hi, fb) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, +n)) : fb);

function sanitize(s) {
  if (!isObj(s)) s = clone(DEFAULTS);
                                                                                                  
                                                                                                   
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (isObj(def) && !isObj(s[k])) s[k] = clone(def);
  }
  const a = s.agent;
  a.maxIterations = clamp(a.maxIterations, 1, 100, 25);
  a.runTimeoutMin = clamp(a.runTimeoutMin, 1, 240, 20);
  a.toolTimeoutSec = clamp(a.toolTimeoutSec, 5, 1800, 120);
  a.maxOutputTokens = clamp(a.maxOutputTokens, 256, 64000, 4096);
  a.temperature = clamp(a.temperature, 0, 2, 0.3);
  a.parallelTools = a.parallelTools !== false;
  a.maxParallelTools = clamp(a.maxParallelTools, 1, 8, 3);
  a.parallelWorkers = a.parallelWorkers !== false;
  a.maxParallelWorkers = clamp(a.maxParallelWorkers, 1, 3, 2);
  a.maxParallelWorkerBatches = clamp(a.maxParallelWorkerBatches, 1, 4, 2);
  a.workerMaxOutputTokens = clamp(a.workerMaxOutputTokens, 600, 8000, 2400);
  if (!['chat', 'assist', 'agent'].includes(a.defaultMode)) a.defaultMode = 'assist';
  s.context.budgetChars = clamp(s.context.budgetChars, 8000, 400000, 60000);
  s.context.compression = s.context.compression !== false;
  s.context.projectKnowledge = s.context.projectKnowledge !== false;
  s.context.recentMessages = clamp(s.context.recentMessages, 4, 40, 10);
  s.context.summaryChars = clamp(s.context.summaryChars, 2000, 40000, 12000);
  s.context.toolObservationChars = clamp(s.context.toolObservationChars, 300, 5000, 900);
  s.context.extraBudgetChars = clamp(s.context.extraBudgetChars, 4000, 120000, 30000);
  s.context.memoryChars = clamp(s.context.memoryChars, 500, 12000, 3500);
  s.context.knowledgeResults = clamp(s.context.knowledgeResults, 1, 12, 6);
  s.prayer.method = clamp(s.prayer.method, 0, 99, 20);
  s.computerControl.osUrl = String(s.computerControl.osUrl || '').trim();
  if (!s.mcp || typeof s.mcp !== 'object') s.mcp = { servers: [] };
  if (!s.browserVision || typeof s.browserVision !== 'object') s.browserVision = { mode: 'smart', maxCallsPerTask: 3, providerId: '', model: '' };
  if (!['smart', 'off'].includes(s.browserVision.mode)) s.browserVision.mode = 'smart';
  s.browserVision.maxCallsPerTask = clamp(s.browserVision.maxCallsPerTask, 1, 10, 3);
  s.browserVision.providerId = String(s.browserVision.providerId || '').trim();
  s.browserVision.model = String(s.browserVision.model || '').trim();
  if (!s.collaboration || typeof s.collaboration !== 'object') s.collaboration = { mode: 'auto', secondaryProviderId: '', secondaryModel: '', maxDelegations: 1 };
  if (!['off', 'auto', 'always'].includes(s.collaboration.mode)) s.collaboration.mode = 'auto';
  s.collaboration.secondaryProviderId = String(s.collaboration.secondaryProviderId || '').trim();
  s.collaboration.secondaryModel = String(s.collaboration.secondaryModel || '').trim();
  s.collaboration.maxDelegations = clamp(s.collaboration.maxDelegations, 1, 3, 1);
  s.mcp.servers = Array.isArray(s.mcp.servers) ? s.mcp.servers.filter((x) => x && typeof x.id === 'string').slice(0, 50) : [];
  s.providers = mergeProviders(s.providers).map((p) => ({
    ...p,
    baseUrl: String(p.baseUrl || '').trim().replace(/\/+$/, ''),
    models: Array.isArray(p.models) ? p.models.filter((m) => typeof m === 'string').slice(0, 500) : [],
  }));
  if (s.collaboration.secondaryProviderId === s.activeModel?.providerId) {
    s.collaboration.secondaryProviderId = '';
    s.collaboration.secondaryModel = '';
  }
  return s;
}

class SettingsStore {
  constructor(db) { this.db = db; this.cache = null; }

  get() {
    if (!this.cache) {
      const row = this.db.get("SELECT value FROM settings WHERE key = 'app'");
      let stored = {};
      try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
      const merged = deepMerge(clone(DEFAULTS), stored);
      const migrated = stored?.migrations?.gpt56LunaPrimary !== true;
      if (migrated) {
        merged.activeModel = { providerId: 'akhtar-openai-router', model: 'gpt-6-luna' };
        merged.routing = { auto: true, light: { providerId: 'akhtar-openai-router', model: 'gpt-5-mini' }, mid: { providerId: 'akhtar-openai-router', model: 'gpt-5-mini' }, heavy: { providerId: 'akhtar-openai-router', model: 'gpt-6-luna' } };
        merged.migrations = { ...(merged.migrations || {}), gpt56LunaPrimary: true };
      }
      const cloudMigrated = stored?.migrations?.cloudRouterV8 !== true;
      if (cloudMigrated) {
        const fixRoute = (route) => {
          if (!route || route.providerId !== 'akhtar-openai-router') return;
          if (route.model === 'gpt-oss-120b') route.model = 'gpt-5-mini';
          if (route.model === 'gpt-5.6-luna') route.model = 'gpt-6-luna';
        };
        fixRoute(merged.activeModel);
        fixRoute(merged.routing?.light);
        fixRoute(merged.routing?.mid);
        fixRoute(merged.routing?.heavy);
        const cloud = merged.providers?.find((p) => p.id === 'akhtar-openai-router');
        if (cloud) cloud.models = ['gpt-5-mini', 'gpt-6-luna'];
        const legacy = merged.providers?.find((p) => p.id === 'akhtar-luna');
        if (legacy) { legacy.models = ['gpt-6-luna']; legacy.label = 'GPT-6 Luna · Akhtar Cloud (legacy URL)'; }
        merged.migrations = { ...(merged.migrations || {}), cloudRouterV8: true };
      }
      const xkiroMigrated = stored?.migrations?.xkiroFreeV1 !== true;
      if (xkiroMigrated) {
        const oldModels = new Set(['gpt-5-mini','gpt-6-luna','gpt-5.6-luna','gpt-oss-120b']);
        if (merged.activeModel?.providerId === 'akhtar-openai-router' && oldModels.has(merged.activeModel.model)) {
          merged.activeModel = { providerId: 'akhtar-xkiro', model: 'xkiro-free-auto' };
        }
        for (const [tier, alias] of Object.entries({ light:'xkiro-free-light', mid:'xkiro-free-mid', heavy:'xkiro-free-heavy' })) {
          const route = merged.routing?.[tier];
          if (route?.providerId === 'akhtar-openai-router' && oldModels.has(route.model)) {
            merged.routing[tier] = { providerId: 'akhtar-xkiro', model: alias };
          }
        }
        merged.migrations = { ...(merged.migrations || {}), xkiroFreeV1: true };
      }
      this.cache = sanitize(merged);
      if (migrated || cloudMigrated || xkiroMigrated) {
        this.db.run("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(this.cache)]);
      }
    }
    return clone(this.cache);
  }

  update(patch) {
    const next = sanitize(deepMerge(this.get(), patch || {}));
    this.db.run("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(next)]);
    this.cache = next;
    return clone(next);
  }

  getProvider(id) { return this.get().providers.find((p) => p.id === id) || null; }
}

module.exports = { SettingsStore, DEFAULTS };
