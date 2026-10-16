'use strict';
                                                                                         
const { assertValid } = require('../utils/schema');
const { logger } = require('../utils/logger');
const { AbortError } = require('../utils/misc');
const { LEVEL } = require('../permissions/levels');
const { evaluateTool } = require('../security/guard');
const { tokenize } = require('../tools/terminal/classifier');
const { withRetry, verifyToolResult, classifyError } = require('./stability');
const { captureBefore, captureAfterAndVerify } = require('./before-after-verifier');

function mayRetryTool(tool, level) {
  if (tool?.retryable === false) return false;
  if (tool?.retryable === true) return true;
  if (level === LEVEL.READ) return true;
  return tool?.name === 'browser.search' || tool?.name === 'browser.open';
}

function withTimeout(operation, timeoutMs, parentSignal) {
  const ctrl = new AbortController();
  let timer = null;
  let onAbortRace = null;
  const abort = (reason) => { if (!ctrl.signal.aborted) ctrl.abort(reason); };
  const onParent = () => abort(parentSignal?.reason?.name === 'AbortError' ? parentSignal.reason : new AbortError('aborted'));
  if (parentSignal) { if (parentSignal.aborted) onParent(); else parentSignal.addEventListener('abort', onParent, { once:true }); }
  if (timeoutMs) timer = setTimeout(() => abort(new AbortError('timeout')), timeoutMs);
                                                                                     
                                                                                     
  const aborted = new Promise((_, reject) => {
    onAbortRace = () => reject(ctrl.signal.reason?.name === 'AbortError' ? ctrl.signal.reason : new AbortError('aborted'));
    if (ctrl.signal.aborted) onAbortRace(); else ctrl.signal.addEventListener('abort', onAbortRace, { once:true });
  });
  aborted.catch(() => {});
  let run;
  try { run = typeof operation === 'function' ? operation(ctrl.signal) : operation; }
  catch (e) { run = Promise.reject(e); }
  const guarded = Promise.resolve(run).catch((e)=>{
    if (ctrl.signal.aborted && ctrl.signal.reason?.name === 'AbortError') throw ctrl.signal.reason;
    throw e;
  });
  guarded.catch(() => {});                                                                    
  return Promise.race([guarded, aborted]).finally(() => {
    if (timer) clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onParent);
    ctrl.signal.removeEventListener('abort', onAbortRace);
  });
}

   
                                                                                        
                                                            
   
const FILE_CONTENT_TOOLS = new Set(['file.write', 'file.create', 'file.edit']);

   
                                                                  
                                                                
                                                               
   
function securityScan(toolName, args) {
  const verdict = evaluateTool(toolName, args || {});
  if (!verdict || verdict.decision !== 'ALLOW') {
    return verdict?.hazards?.length ? verdict.hazards : ['guard returned an invalid/unsafe verdict'];
  }
  return [];
}

   
                                                                                             
   
async function executeTool(app, toolName, args, ctx, conversationId) {
  const tool = app.registry.get(toolName);
  if (!tool) throw new Error(`Unknown tool "${toolName}". Call the right tool from your available list.`);
                                                                                       
                                                 
  if (!app.registry.forMode(ctx.mode, { hasWorkspace: !!ctx.workspace }).some((t) => t.name === toolName)) {
    throw new Error(`Tool "${toolName}" is unavailable in mode "${ctx.mode}"${ctx.workspace ? '' : ' without a workspace'}.`);
  }
  assertValid(tool.inputSchema, args || {}, toolName);

  const hazards = securityScan(toolName, args);
  if (hazards.length) {
    logger.agent('error', `SECURITY LAYER blocked ${toolName}`, { hazards });
    const err = new Error(`Diblokir oleh security layer (bukan bisa di-override lewat izin): ${hazards.join('; ')}. Kalau ini keliru untuk kebutuhan legitimate, kerjakan bagian ini secara manual di luar agent.`);
    err.securityBlocked = true;
    if (ctx.taskId) app.tasks.addEvent(ctx.taskId, 'security_blocked', err.message, { tool: toolName, hazards });
    throw err;
  }

  let preview = null;
  if (tool.preview) preview = await tool.preview(args, ctx);

  const level = preview?.level || (typeof tool.permission === 'function' ? tool.permission(args, ctx) : tool.permission);
  const category = preview?.category || tool.category || tool.group;

  const logId = ctx.taskId ? app.tasks.logToolCall({ taskId: ctx.taskId, conversationId, name: toolName, args }) : null;
  try {
    const decision = await (ctx.unattended
      ? app.permissions.checkUnattended({ level, category, workspaceId: ctx.workspaceId, lifetime: tool.lifetimePermission === true })
      : app.permissions.check({
        level, category, mode: ctx.mode, workspaceId: ctx.workspaceId, signal: ctx.signal, lifetime: tool.lifetimePermission === true,
        request: {
          name: toolName, title: preview?.title || toolName, summary: preview?.summary,
          diff: preview?.diff, warning: preview?.warning, command: preview?.command, path: preview?.path,
        },
      }));
    if (!decision.allowed) {
      const err = new Error(decision.reason || `Permission denied for ${toolName}.`);
      err.permissionDenied = true;
      throw err;
    }
    const timeoutMs = typeof tool.timeoutMs === 'function' ? tool.timeoutMs(args, ctx) : (tool.timeoutMs || 120000);
    if (logId) app.tasks.setToolCallState?.(logId, 'running');
                                                                                         
    app.db?.saveNow?.();
    let beforeAfterBefore = null;
    try { beforeAfterBefore = await captureBefore(toolName, args || {}, ctx); }
    catch (e) { if (ctx.taskId) app.tasks.addEvent(ctx.taskId, 'verification_capture_error', `Before-state capture failed for ${toolName}: ${e.message}`, { tool: toolName, phase: 'before' }); }
    const result = await withRetry(async (attempt) => withTimeout((toolSignal) => tool.execute(args, { ...ctx, app, signal: toolSignal, attempt }), timeoutMs, ctx.signal), {
      retries: mayRetryTool(tool, level) ? 2 : 0, signal: ctx.signal, onRetry: (e, attempt) => {
        if (ctx.taskId) app.tasks.addEvent(ctx.taskId, 'tool_retry', `${toolName} transient failure; retry ${attempt}/2`, { tool: toolName, error: e.message, attempt });
      },
    });
    if (logId) app.tasks.setToolCallState?.(logId, 'verifying');
    let beforeAfter = null;
    try {
      beforeAfter = await captureAfterAndVerify(toolName, args || {}, ctx, beforeAfterBefore);
      if (beforeAfter && ctx.taskId) app.tasks.addEvent(ctx.taskId, 'before_after_verification', `${toolName}: ${beforeAfter.confirmed ? 'confirmed' : 'checked but unconfirmed'}`, { tool: toolName, confirmed: beforeAfter.confirmed, signals: beforeAfter.signals, reason: beforeAfter.reason });
    } catch (e) {
      if (ctx.taskId) app.tasks.addEvent(ctx.taskId, 'verification_capture_error', `After-state capture failed for ${toolName}: ${e.message}`, { tool: toolName, phase: 'after' });
    }
    const resultForVerification = (result && typeof result === 'object' && beforeAfter) ? { ...result, _beforeAfter: beforeAfter } : result;
    const verification = await verifyToolResult(tool, args, resultForVerification, ctx);
    const verifiedResult = (resultForVerification && typeof resultForVerification === 'object') ? { ...resultForVerification, _verification: verification } : resultForVerification;
    if (logId) app.tasks.finishToolCall(logId, { status: 'success', result: verifiedResult });
    app.db?.saveNow?.();
    return verifiedResult;
  } catch (e) {
    logger.tools('error', `${toolName} failed`, { message: e.message });
    if (logId) { const kind = classifyError(e); app.tasks.finishToolCall(logId, { status: kind === 'timeout' ? 'timeout' : kind === 'cancelled' ? 'cancelled' : e.securityBlocked ? 'blocked' : 'failed', result: { error: e.message } }); }
    app.db?.saveNow?.();
    throw e;
  }
}

module.exports = { executeTool, withTimeout, mayRetryTool };
