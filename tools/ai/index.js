'use strict';
                                                                
const { LEVEL } = require('../../permissions/levels');
const { createProvider } = require('../../providers/llm');
const { structuredSecondarySystem } = require('../../agent/dual-ai-strategy');
const { sanitizeJobs, chooseConcurrency, structuredWorkerSystem, runWorkerPool } = require('../../agent/parallel-worker-lite');

function providerKey(ctx, cfg) {
  if (['supabase-openai','supabase-xkiro'].includes(cfg.type)) return ctx.authToken || '';
  return ctx.secrets.get(`llm:${cfg.id}`) || '';
}

function pickProvider(ctx, requested) {
  const settings = ctx.settings;
  const activeId = settings.activeModel?.providerId;
  const collab = settings.collaboration || {};
  if (collab.mode === 'off') throw new Error('AI collaboration is disabled in Settings.');
  const candidates = settings.providers.filter((p) => p.id !== activeId && (p.type === 'pollinations' || ['supabase-openai','supabase-xkiro'].includes(p.type) || ctx.secrets.has(`llm:${p.id}`)));
  const preferredId = requested || collab.secondaryProviderId || '';
  const cfg = preferredId ? settings.providers.find((p) => p.id === preferredId) : candidates[0];
  if (!cfg) throw new Error(requested ? `Unknown AI provider "${requested}".` : 'No second AI provider is configured. Add another API key in Settings → Models.');
  if (cfg.id === activeId) throw new Error('Delegate must use a different provider from the primary agent.');
  const provider = createProvider(cfg, providerKey(ctx, cfg));
  provider.ensureKey();
  return { cfg, provider };
}

function pickWorkerProvider(ctx, requestedProviderId = '', requestedModel = '') {
  const settings = ctx.settings;
  const preferredRoute = settings.routing?.mid || {};
  const preferredId = requestedProviderId || preferredRoute.providerId || settings.activeModel?.providerId;
  let cfg = settings.providers.find((p) => p.id === preferredId);
  if (!cfg) cfg = settings.providers.find((p) => p.id === settings.activeModel?.providerId);
  if (!cfg) throw new Error('No AI provider is configured for Parallel Worker Lite.');

  let model = requestedModel || (preferredId === preferredRoute.providerId ? preferredRoute.model : '') ||
    (cfg.id === settings.activeModel?.providerId ? settings.activeModel?.model : '') || cfg.models?.[0];
  if (!model) throw new Error(`No model configured for ${cfg.label}.`);

                                                                                 
  const probe = createProvider(cfg, providerKey(ctx, cfg));
  probe.ensureKey();
  return { cfg, model };
}

const delegateTool = {
  name: 'ai.delegate', group: 'ai',
  description: 'Ask a SECOND configured AI model to solve a bounded hard subtask or independently review reasoning/code. Use only when another perspective materially helps; do not delegate trivial work.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'Self-contained subtask for the second AI.' },
      context: { type: 'string', description: 'Only the minimum context the second AI needs. Never include secrets.' },
      role: { type: 'string', enum: ['specialist', 'reviewer', 'critic'], default: 'specialist' },
      provider_id: { type: 'string', description: 'Optional provider id. Must differ from the primary provider.' },
      model: { type: 'string', description: 'Optional model override; otherwise uses provider configured model or first known model.' },
    }, required: ['prompt'],
  },
  permission: LEVEL.NETWORK, category: 'network.ai_delegate',
  preview: async (args) => ({ title: `Ask second AI${args.provider_id ? ` (${args.provider_id})` : ''}`, summary: args.prompt.slice(0, 180), warning: 'The supplied prompt/context is sent to another AI provider.' }),
  timeoutMs: 180000,
  execute: async (args, ctx) => {
    const { cfg, provider } = pickProvider(ctx, args.provider_id);
    const collab = ctx.settings.collaboration || {};
    const model = args.model || (cfg.id === collab.secondaryProviderId ? collab.secondaryModel : '') || cfg.models?.[0];
    if (!model) throw new Error(`No model configured for ${cfg.label}. Choose a model in Settings or pass model.`);
    const system = structuredSecondarySystem(args.role || 'specialist');
    const content = args.context ? `${args.prompt}\n\nContext from primary agent:\n${String(args.context).slice(0, 30000)}` : args.prompt;
    const result = await provider.generate({ model, system, messages: [{ role: 'user', content }], tools: [], signal: ctx.signal, maxTokens: Math.min(ctx.settings.agent.maxOutputTokens || 4096, 8192), temperature: 0.2 });
    return { provider: cfg.id, model, role: args.role || 'specialist', answer: result.text, usage: result.usage || null };
  },
};

const parallelWorkersTool = {
  name: 'ai.parallel_workers', group: 'ai',
  description: 'Run 2–3 independent, tool-less AI worker subtasks concurrently, then return all results to the primary agent for synthesis and verification. Best for separable research/analysis/code-draft/test-review work. Workers cannot modify files or control the OS.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      jobs: {
        type: 'array', minItems: 2, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'Short worker label.' },
            role: { type: 'string', enum: ['researcher', 'analyst', 'coder', 'tester', 'reviewer', 'critic'] },
            task: { type: 'string', description: 'Self-contained independent subtask.' },
            context: { type: 'string', description: 'Minimum non-secret context needed by this worker.' },
          },
          required: ['task'],
        },
      },
      max_workers: { type: 'integer', minimum: 1, maximum: 3, description: 'Optional requested concurrency. Resource guard may lower it.' },
      provider_id: { type: 'string', description: 'Optional provider override. Defaults to the configured mid/lightweight route.' },
      model: { type: 'string', description: 'Optional model override.' },
    },
    required: ['jobs'],
  },
  permission: LEVEL.NETWORK, category: 'network.ai_parallel_workers',
  preview: async (args) => ({
    title: `Parallel Worker Lite · ${Array.isArray(args.jobs) ? args.jobs.length : 0} worker`,
    summary: (args.jobs || []).map((j) => `${j.role || 'analyst'}: ${String(j.task || '').slice(0, 80)}`).join(' · ').slice(0, 260),
    warning: 'Workers are read-only AI calls with no tools. Prompts/context are sent to the selected AI provider.',
  }),
  timeoutMs: 240000,
  toolIntelligence: { sideEffects: false, risk: 'NETWORK', capabilities: ['parallel analysis', 'independent review', 'draft code/tests'] },
  execute: async (args, ctx) => {
    const jobs = sanitizeJobs(args.jobs);
    const cfgAgent = ctx.settings.agent || {};
    const policy = chooseConcurrency({
      requested: args.max_workers || jobs.length,
      configured: cfgAgent.maxParallelWorkers || 2,
      enabled: cfgAgent.parallelWorkers !== false,
    });
    const { cfg, model } = pickWorkerProvider(ctx, args.provider_id, args.model);
    const apiKey = providerKey(ctx, cfg);
    const maxTokens = Math.min(cfgAgent.workerMaxOutputTokens || 2400, cfgAgent.maxOutputTokens || 4096, 8000);

    const results = await runWorkerPool(jobs, {
      concurrency: policy.concurrency,
      onStart: (job) => ctx.onOutput?.(`[worker:${job.id}] ${job.role} started\n`),
      onFinish: (job, _index, result) => ctx.onOutput?.(`[worker:${job.id}] ${result.ok ? 'done' : 'failed'}\n`),
      run: async (job) => {
        const provider = createProvider(cfg, apiKey);
        provider.ensureKey();
        const content = job.context ? `${job.task}\n\nCONTEXT FROM PRIMARY AGENT:\n${job.context}` : job.task;
        const result = await provider.generate({
          model,
          system: structuredWorkerSystem(job.role),
          messages: [{ role: 'user', content }],
          tools: [],
          signal: ctx.signal,
          maxTokens,
          temperature: 0.2,
        });
        return { answer: result.text, usage: result.usage || null };
      },
    });

    return {
      mode: 'parallel-worker-lite',
      provider: cfg.id,
      model,
      requested_workers: jobs.length,
      concurrency: policy.concurrency,
      resource_fallback: policy.fallback,
      fallback_reason: policy.reason,
      resource: {
        memory_pressure: Number(policy.snapshot.memoryPressure.toFixed(3)),
        cpu_load_ratio: Number(policy.snapshot.loadRatio.toFixed(3)),
        cpu_count: policy.snapshot.cpuCount,
      },
      workers: results,
      instruction: 'Primary agent must synthesize these worker outputs, verify claims with real tools, and perform all side effects itself.',
    };
  },
};

module.exports = [delegateTool, parallelWorkersTool];
