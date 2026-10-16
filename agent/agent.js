'use strict';
   
                                                                       
                                                
  
                                                                   
                                                    
  
                                                                        
                                                                            
                                                                            
                             
   
const { AbortError, isAbort } = require('../utils/misc');
const { ToolRegistry } = require('../tools/registry');
const { getProvider, routeForRequest } = require('./model-router');
const { buildSystemPrompt } = require('./planner');
const { createToolContext, budgetMessages, repairToolPairs } = require('./context');
const { manageContext, buildMemoryContext, budgetSystemExtras } = require('./context-budget-manager');
const { executeTool } = require('./executor');
const { logger } = require('../utils/logger');
const { shortlistTools, ToolFailureMemory } = require('./tool-intelligence');
const { inferSkillNames, loadRelevantSkills, buildSkillContext } = require('./skill-intelligence');
const { runParallelToolCalls } = require('./parallel-engine');
const { scoreDelegation, strategyPrompt } = require('./dual-ai-strategy');
const { chargeSafely } = require('../billing/credits');
const { isRetryableModelError } = require('../providers/llm/provider');
const { successObservation, errorObservation, serializeToolObservation } = require('./tool-sense');

const safeJson = (v) => { try { return JSON.stringify(v ?? null).slice(0, 20000); } catch { return String(v); } };
const noop = () => {};

class Agent {
  constructor(app) { this.app = app; }

     
                      
                                     
                                       
                                            
                                                                                         
                                                                                     
                                                                          
     
  async run({ conversationId, workspaceId, mode, text, onEvent = noop, signal, unattended = false, takeover = null, resumeTaskId = null }) {
    const app = this.app;
    const isResume = !!resumeTaskId;
    let task;
    let resumeInfo = null;

    if (isResume) {
      const existing = app.tasks.get(resumeTaskId);
      if (!existing) throw new Error('Interrupted task not found.');
      if (existing.status !== 'interrupted') throw new Error(`Task cannot be resumed from status "${existing.status}".`);
      conversationId = existing.conversation_id;
      workspaceId = existing.workspace_id || null;
      mode = existing.mode || 'assist';
      const originalUser = app.repos.lastUserMessageBefore(conversationId, existing.created_at);
      text = originalUser?.content || existing.title || 'Resume interrupted task';
      resumeInfo = app.tasks.resumeContext(existing.id);
      task = app.tasks.resume(existing.id);
    } else {
      app.repos.addMessage({ conversationId, role: 'user', content: text });
      task = app.tasks.create({ conversationId, workspaceId, title: text.slice(0, 80) || 'New task', mode });
    }

                                                                                        
    app.db?.saveNow?.();
    const workspace = workspaceId ? app.repos.getWorkspace(workspaceId) : null;
    const settings = app.settings.get();
    onEvent({ type: 'task_start', task, resumed: isResume, resumeInfo: isResume ? { uncertain: resumeInfo?.uncertain?.length || 0, resumeCount: resumeInfo?.resume_count || 0 } : null });
    if (isResume) onEvent({ type: 'resume_recovery', taskId: task.id, uncertain: resumeInfo?.uncertain || [] });

    const ctrl = new AbortController();
    const timeoutTimer = setTimeout(() => ctrl.abort(new AbortError('timeout')), settings.agent.runTimeoutMin * 60 * 1000);
    const onExternalAbort = () => ctrl.abort(signal?.reason || new AbortError('aborted'));
    if (signal) { if (signal.aborted) onExternalAbort(); else signal.addEventListener('abort', onExternalAbort, { once: true }); }

    const availableTools = app.registry.forMode(mode, { hasWorkspace: !!workspace });
    const failureMemory = new ToolFailureMemory();
    const usedToolNames = new Set();
    if (isResume) for (const c of app.tasks.listToolCalls(task.id)) if (c?.name) usedToolNames.add(c.name);
    let projectKnowledge = [];
    if (workspace && settings.context.projectKnowledge && app.knowledge) {
      try {
        const idx = app.knowledge.index(workspace);
        projectKnowledge = app.knowledge.search(workspace, text, { limit: settings.context.knowledgeResults });
        app.tasks.addEvent(task.id, 'knowledge', `Project knowledge: ${projectKnowledge.length} relevant chunk(s)`, { index: idx, paths: projectKnowledge.map(x => x.path) });
        onEvent({ type: 'knowledge', count: projectKnowledge.length, paths: projectKnowledge.map(x => x.path) });
      } catch (e) { app.tasks.addEvent(task.id, 'knowledge_error', e.message); }
    }
    const knowledgeText = projectKnowledge.length ? projectKnowledge.map(x => `FILE ${x.path} [chunk ${x.chunk}]\n${x.content}`).join('\n\n---\n\n') : '';
    let baseSystem = buildSystemPrompt({ mode, workspace, skills: app.skills.list(), dateTimeIso: new Date().toISOString(), unattended, collaboration: settings.collaboration, parallelWorkers: settings.agent?.parallelWorkers !== false, maxParallelWorkers: settings.agent?.maxParallelWorkers || 2, projectKnowledge: knowledgeText });
    if (isResume) {
      const uncertain = (resumeInfo?.uncertain || []).map((c) => `- ${c.name}(${JSON.stringify(c.args || {}).slice(0, 500)}): ${c.status}; MAY already have taken effect`).join('\n') || '- none';
      const completed = (resumeInfo?.completed || []).map((c) => c.name).join(', ') || 'none recorded';
      baseSystem += `\n\nCRASH RESUME MODE (safety-critical):\nThis is a continuation of an interrupted task, not a new request. Preserve the user's original goal and continue from persisted conversation/tool history.\nCompleted recent tools: ${completed}.\nUncertain interrupted tools:\n${uncertain}\nRules: NEVER blindly replay an uncertain side-effecting action. First re-observe/re-read the relevant state using a read-only tool. If the effect is already present, treat that step as complete. If it is absent, then retry only after normal permission/security checks. For terminal/file/network/GUI writes, assume the action MAY have completed until verified. Explain only if recovery materially affects the result.`;
    }
    const initialTools = shortlistTools(availableTools, { text, mode });
    const initialGroups = [...new Set(initialTools.map(t => t.group || String(t.name).split('.')[0]))];
    const relevantSkillNames = inferSkillNames(text, { mode, toolGroups: initialGroups });
    const loadedSkills = loadRelevantSkills(app.skills, relevantSkillNames);
    const skillContext = buildSkillContext(loadedSkills);
    let durableMemories = [];
    try { durableMemories = app.memory?.list?.(workspaceId) || []; } catch {}
    const memoryContext = buildMemoryContext(durableMemories, text, settings.context.memoryChars);
    const extras = budgetSystemExtras({ skillContext, memoryContext, maxChars: settings.context.extraBudgetChars });
    const extraText = extras.parts.map(p => p.text).filter(Boolean).join('\n\n');
    const system = extraText ? `${baseSystem}\n\n${extraText}` : baseSystem;
    if (loadedSkills.length) {
      app.tasks.addEvent(task.id, 'skills_loaded', `Runtime loaded ${loadedSkills.length} relevant SKILL.md file(s)`, { skills: loadedSkills.map(s => s.name) });
      onEvent({ type: 'skills_loaded', skills: loadedSkills.map(s => s.name) });
    }
    const maxIter = settings.agent.maxIterations;
    let finalMessage = null;
    let dualAiFailures = 0;
    let usedDelegations = 0;
    let usedWorkerBatches = 0;
    let creditsExhausted = false;

    try {
      for (let iter = 0; iter < maxIter; iter++) {
        if (ctrl.signal.aborted) throw new AbortError(ctrl.signal.reason?.reason || 'aborted');
        if (creditsExhausted) throw new Error('Not enough Akhtar credits to continue this task. Top up or switch to your own API key, then continue.');
        if (takeover) await takeover.safePoint(`before model iteration ${iter + 1}`, ctrl.signal);

        const rawHistory = app.repos.listMessages(conversationId);
        const compressed = settings.context.compression
          ? manageContext(rawHistory, { budgetChars: settings.context.budgetChars, recentCount: settings.context.recentMessages, summaryChars: settings.context.summaryChars, toolObservationChars: settings.context.toolObservationChars })
          : { messages: budgetMessages(rawHistory, settings.context.budgetChars), compressed: false, managed: false, savedChars: 0 };
        const history = repairToolPairs(compressed.messages);
        if (compressed.managed && iter === 0) {
          app.tasks.addEvent(task.id, 'context_budget', `Context Budget Manager saved ~${compressed.savedChars} chars`, { savedChars: compressed.savedChars, beforeChars: compressed.beforeChars, afterChars: compressed.afterChars, keptMessages: history.length, extraContextChars: extras.usedChars });
          onEvent({ type: 'context_budget', savedChars: compressed.savedChars, beforeChars: compressed.beforeChars, afterChars: compressed.afterChars, keptMessages: history.length });
        }
        const tools = shortlistTools(availableTools, { text, mode, previousToolNames: [...usedToolNames] });
        const delegationDecision = scoreDelegation({ text, mode, iteration: iter, failureCount: dualAiFailures, toolCalls: usedToolNames.size, hasWrites: [...usedToolNames].some(n => /^(file\.(write|edit|create)|terminal\.|git\.|github\.)/.test(n)), collaboration: settings.collaboration });
        const delegationNote = strategyPrompt(delegationDecision, { maxDelegations: settings.collaboration?.maxDelegations || 1, usedDelegations });
        const toolSchemas = ToolRegistry.toSchemas(tools);
        if (iter === 0) {
          app.tasks.addEvent(task.id, 'tool_shortlist', `Tool intelligence exposed ${tools.length}/${availableTools.length} relevant tools`, { tools: tools.map(t => t.name) });
          onEvent({ type: 'tool_shortlist', count: tools.length, total: availableTools.length });
        }
        const routed = routeForRequest(settings, { text, mode, iteration: iter, history });
        const selected = routed ? { providerId: routed.providerId, model: routed.model } : null;
        const selectedId = selected?.providerId || settings.activeModel?.providerId;
        const activeCfg = settings.providers.find((p) => p.id === selectedId);
        const authToken = ['supabase-openai','supabase-xkiro'].includes(activeCfg?.type) ? await app.auth.accessToken() : '';
        const { provider, model, providerConfig } = getProvider(settings, app.secrets, selected, authToken);
        if (routed && iter === 0) onEvent({ type: 'model_route', tier: routed.tier, provider: providerConfig.id, model });

        let assistantText = '';
        const toolCalls = [];
        onEvent({ type: 'stream_start', iteration: iter });
        app.tasks.addEvent(task.id, 'iteration', `Agent iteration ${iter + 1}`, { iteration: iter + 1, provider: providerConfig.id, model, tier: routed?.tier || 'manual' });
                                                                                               
                                                                                              
                                                                               
        const MODEL_ATTEMPTS = 3;
        for (let attempt = 1; ; attempt++) {
          assistantText = ''; toolCalls.length = 0;
          let streamedSomething = false;
          try {
            for await (const ev of provider.stream({
              model, system: [system, delegationNote, failureMemory.promptNote()].filter(Boolean).join('\n'), messages: history, tools: toolSchemas, signal: ctrl.signal,
              maxTokens: settings.agent.maxOutputTokens, temperature: settings.agent.temperature,
            })) {
              if (ev.type === 'text') { streamedSomething = true; assistantText += ev.delta; onEvent({ type: 'text_delta', delta: ev.delta }); }
              else if (ev.type === 'tool_call') toolCalls.push(ev);
              else if (ev.type === 'usage') { onEvent({ type: 'usage', usage: ev.usage }); app.tasks.addEvent(task.id, 'usage', 'Model usage', ev.usage); }
            }
            break;
          } catch (e) {
            if (ctrl.signal.aborted) throw e;
            if (attempt >= MODEL_ATTEMPTS || !isRetryableModelError(e)) throw new Error(`Model error: ${e.message}`);
            const waitMs = Math.min(30000, Math.max(e.retryAfterMs || 0, 1500 * (2 ** (attempt - 1))));
            app.tasks.addEvent(task.id, 'model_retry', `Model call failed (${e.message}); retry ${attempt}/${MODEL_ATTEMPTS - 1} in ${Math.round(waitMs / 1000)}s`, { attempt, waitMs });
            if (streamedSomething) onEvent({ type: 'stream_reset' });
            onEvent({ type: 'model_retry', attempt, waitMs, error: e.message });
            await new Promise((resolve) => {
              const t = setTimeout(done, waitMs);
              function done() { clearTimeout(t); ctrl.signal.removeEventListener('abort', done); resolve(); }
              ctrl.signal.addEventListener('abort', done, { once: true });
            });
            if (ctrl.signal.aborted) throw new AbortError(ctrl.signal.reason?.reason || 'aborted');
          }
        }

        let outOfCredits = false;
        if (app.credits) {
          const c = await chargeSafely(() => app.credits.spendEffort(routed?.tier || 'manual', task.id));
          if (c.charged) onEvent({ type: 'credits_changed' });
          else if (c.error) app.tasks.addEvent(task.id, 'credits_skipped', c.error.message, { code: c.error.code || null });
          outOfCredits = c.stop;
        }

        const assistantMsg = app.repos.addMessage({
          conversationId, role: 'assistant', content: assistantText,
                                                                                                     
                                                                                      
          toolCalls: toolCalls.length ? toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments, ...(c.meta ? { meta: c.meta } : {}) })) : null,
        });
        onEvent({ type: 'assistant_message', message: assistantMsg });

        if (!toolCalls.length) { finalMessage = assistantMsg; break; }
        if (outOfCredits || creditsExhausted) throw new Error('Not enough Akhtar credits to continue this task. Top up or switch to your own API key, then continue.');

        const toolCtx = createToolContext(app, {
          workspace, workspaceId, taskId: task.id, mode, signal: ctrl.signal, unattended,
          onOutput: (chunk) => onEvent({ type: 'tool_output', chunk }),
          authToken,
        });

        const runOneToolCall = async (call) => {
          if (takeover) await takeover.safePoint(`before ${call.name}`, ctrl.signal);
          if (ctrl.signal.aborted) throw new AbortError('aborted');
          usedToolNames.add(call.name);
          if (call.name === 'ai.parallel_workers') {
            const maxB = settings.agent?.maxParallelWorkerBatches || 2;
            if (usedWorkerBatches >= maxB) {
              const msg = `Parallel Worker Lite batch budget exhausted (${usedWorkerBatches}/${maxB}). Continue with the primary agent instead of spawning more workers.`;
              app.repos.addMessage({ conversationId, role: 'tool', content: serializeToolObservation(errorObservation(call, new Error(msg), { worker_batch_budget_exhausted: true }, 'blocked')), toolCallId: call.id, toolName: call.name });
              onEvent({ type: 'tool_call_end', call, error: msg, ok: false });
              return { ok: false, error: new Error(msg) };
            }
            usedWorkerBatches += 1;
          }
          if (call.name === 'ai.delegate') {
            const maxD = settings.collaboration?.maxDelegations || 1;
            if (usedDelegations >= maxD) {
              const msg = `Dual-AI delegation budget exhausted (${usedDelegations}/${maxD}). Continue with primary-agent verification.`;
              app.repos.addMessage({ conversationId, role: 'tool', content: serializeToolObservation(errorObservation(call, new Error(msg), { delegation_budget_exhausted: true }, 'blocked')), toolCallId: call.id, toolName: call.name });
              onEvent({ type: 'tool_call_end', call, error: msg, ok: false });
              return { ok: false, error: new Error(msg) };
            }
            usedDelegations += 1;
          }
          if (failureMemory.shouldReplan(call.name, call.arguments)) {
            const msg = `Repeated identical tool strategy blocked after ${failureMemory.maxSameStrategy} failures. Re-observe or replan instead of retrying ${call.name}.`;
            app.repos.addMessage({ conversationId, role: 'tool', content: serializeToolObservation(errorObservation(call, new Error(msg), { replan_required: true }, 'blocked')), toolCallId: call.id, toolName: call.name });
            app.tasks.addEvent(task.id, 'tool_replan', msg, { tool: call.name });
            onEvent({ type: 'tool_call_end', call, error: msg, ok: false, replan: true });
            return { ok: false, replan: true };
          }
          onEvent({ type: 'tool_call_start', call });
          app.tasks.addEvent(task.id, 'tool_start', call.name, { toolCallId: call.id, args: call.arguments });
          try {
            const result = await executeTool(app, call.name, call.arguments, toolCtx, conversationId);
            if (app.credits) {
              const c = await chargeSafely(() => app.credits.spendTool(call.name, call.arguments || {}, task.id));
              if (c.charged) onEvent({ type: 'credits_changed' });
              else if (c.error) app.tasks.addEvent(task.id, 'credits_skipped', c.error.message, { code: c.error.code || null });
              if (c.stop) creditsExhausted = true;
            }
            const toolObservation = successObservation(call, result);
            app.repos.addMessage({ conversationId, role: 'tool', content: serializeToolObservation(toolObservation), toolCallId: call.id, toolName: call.name });
            onEvent({ type: 'tool_sense', callId: call.id, tool: call.name, observation: toolObservation });
            onEvent({ type: 'tool_call_end', call, result, ok: true });
            if (result?._beforeAfter) onEvent({ type: 'before_after_verification', callId: call.id, tool: call.name, confirmed: result._beforeAfter.confirmed === true, signals: result._beforeAfter.signals || [], reason: result._beforeAfter.reason || '' });
            app.tasks.addEvent(task.id, 'tool_end', `${call.name} completed`, { toolCallId: call.id, ok: true });
            if (takeover) await takeover.safePoint(`after ${call.name}`, ctrl.signal);
            return { ok: true, result };
          } catch (e) {
                                                                                                 
                                                                                                     
            if (ctrl.signal.aborted) throw e;
            const failure = failureMemory.record(call.name, call.arguments, e.message);
            dualAiFailures += 1;
            const toolObservation = errorObservation(call, e, { attempts_same_strategy: failure.attempts, replan_required: failure.attempts >= failureMemory.maxSameStrategy }, e.securityBlocked ? 'blocked' : e.permissionDenied ? 'denied' : 'failed');
            app.repos.addMessage({ conversationId, role: 'tool', content: serializeToolObservation(toolObservation), toolCallId: call.id, toolName: call.name });
            onEvent({ type: 'tool_sense', callId: call.id, tool: call.name, observation: toolObservation });
            app.tasks.addEvent(task.id, 'tool_error', e.message, { tool: call.name });
            onEvent({ type: 'tool_call_end', call, error: e.message, ok: false });
            return { ok: false, error: e };
          }
        };

        const parallelEnabled = settings.agent.parallelTools !== false && toolCalls.length > 1;
        if (parallelEnabled) {
          const limit = settings.agent.maxParallelTools || 3;
          onEvent({ type: 'parallel_start', count: toolCalls.length, maxConcurrency: limit });
          app.tasks.addEvent(task.id, 'parallel_start', `Parallel engine scheduling ${toolCalls.length} tool calls (max ${limit})`, { count: toolCalls.length, maxConcurrency: limit });
          const parallelResult = await runParallelToolCalls(toolCalls, {
            maxConcurrency: limit,
            execute: runOneToolCall,
            onWave: ({ wave, totalWaves, calls }) => {
              const names = calls.map(c => c.name);
              onEvent({ type: 'parallel_wave', wave, totalWaves, tools: names });
              app.tasks.addEvent(task.id, 'parallel_wave', `Parallel wave ${wave}/${totalWaves}: ${names.join(', ')}`, { wave, totalWaves, tools: names });
            },
          });
          onEvent({ type: 'parallel_end', waves: parallelResult.waves.length });
          app.tasks.addEvent(task.id, 'parallel_end', `Parallel execution completed in ${parallelResult.waves.length} wave(s)`, { waves: parallelResult.waves.length });
        } else {
          for (const call of toolCalls) await runOneToolCall(call);
        }
      }
      if (!finalMessage) throw new Error(`Stopped after ${maxIter} steps without a final answer. Try narrowing the request.`);

      app.tasks.update(task.id, { status: 'completed' });
      if (isResume) app.tasks.addEvent(task.id, 'resume_completed', 'Crash Resume completed successfully.');
      app.db?.saveNow?.();
      onEvent({ type: 'task_end', status: 'completed', task: app.tasks.get(task.id), resumed: isResume });
      return { task: app.tasks.get(task.id), message: finalMessage };
    } catch (e) {
      const aborted = isAbort(e, ctrl.signal);
      const abortReason = e?.reason ?? ctrl.signal.reason?.reason;
      const status = aborted ? (abortReason === 'timeout' ? 'timeout' : 'stopped') : 'failed';
      app.tasks.update(task.id, { status, error: aborted ? null : e.message });
      app.db?.saveNow?.();
      logger.agent(status === 'failed' ? 'error' : 'warn', `Task ${task.id} ended: ${status}`, { error: e.message });
      onEvent({ type: 'task_end', status, error: aborted ? null : e.message, task: app.tasks.get(task.id) });
      if (!aborted) throw e;
      return { task: app.tasks.get(task.id), message: null };
    } finally {
      clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

module.exports = { Agent };
