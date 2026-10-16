'use strict';
   
                                                                          
                                                                      
                                                                        
                                         
   

function createToolContext(app, { workspace, workspaceId, taskId, mode, signal, onOutput, unattended = false, authToken = '' }) {
  return {
    db: app.db,
    workspace: workspace || null,
    workspaceId: workspaceId || null,
    taskId: taskId || null,
    mode,
    signal,
    unattended,
    onOutput: onOutput || (() => {}),
    settings: app.settings.get(),
    authToken: authToken || '',
    skills: app.skills,
    registry: app.registry,
    todo: app.todo,
    memory: app.memory,
    checkpoints: app.checkpoints,
    artifacts: app.artifacts,
    artifactsDir: app.artifactsDir,
    secrets: app.secrets,
    browser: app.browserTabs,
    browserVision: app.browserVision,
    osBundleUrl: app.osBundleUrl,
    osPreloadPath: app.osPreloadPath,
    scheduler: app.scheduler,
    mcp: app.mcp,
    knowledge: app.knowledge,
  };
}

                                                                                                 
function budgetMessages(messages, budgetChars) {
  let total = 0;
  const kept = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const len = (m.content || '').length + JSON.stringify(m.toolCalls || '').length;
    if (kept.length > 0 && total + len > budgetChars) break;
    total += len;
    kept.unshift(m);
  }
  return kept.length ? kept : messages.slice(-1);
}

   
                                                               
                                                                                         
                                                                                          
                                                                 
                                                                                       
                                                
   
function repairToolPairs(messages) {
  const src = Array.isArray(messages) ? messages : [];
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const m = src[i];
    if (m.role === 'tool') continue;                                                    
    if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      const ids = new Set(m.toolCalls.map((c) => c.id));
      const results = new Map();
      let j = i + 1;
      for (; j < src.length && src[j].role === 'tool'; j++) {
        if (ids.has(src[j].toolCallId) && !results.has(src[j].toolCallId)) results.set(src[j].toolCallId, src[j]);
      }
      out.push(m);
      for (const c of m.toolCalls) {
        out.push(results.get(c.id) || { role: 'tool', toolCallId: c.id, toolName: c.name, content: JSON.stringify({ schema: 'TOOL_SENSE_V1', call_id: c.id, tool: c.name, status: 'interrupted', data: null, error: { message: 'Tool call was interrupted before it returned a result.' }, verification: null, meta: { interrupted: true } }) });
      }
      i = j - 1;
      continue;
    }
    out.push(m);
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out.length ? out : src.filter((m) => m.role === 'user').slice(-1);
}

module.exports = { createToolContext, budgetMessages, repairToolPairs };
