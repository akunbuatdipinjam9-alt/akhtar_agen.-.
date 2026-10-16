'use strict';
                                                                                               
const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createProvider } = require('../providers/llm');
const { logger } = require('../utils/logger');
const { diagnoseTask } = require('../agent/black-box');
const { OBSERVE_SCRIPT } = require('./browser-accessibility');

function publicProvider(p, secrets) {
  const requiresKey = createProvider(p, '').requiresKey;
  return { id: p.id, type: p.type, label: p.label, baseUrl: p.baseUrl, models: p.models, hasKey: ['supabase-openai','supabase-xkiro'].includes(p.type) ? true : secrets.has(`llm:${p.id}`), requiresKey };
}

function registerIpc(app, initialWin) {
                                                                                          
  const currentWin = () => { const w = app.getWindow?.() || initialWin; return w && !w.isDestroyed() ? w : null; };
                                                                                        
                                                                                         
  const fromMainUi = (evt) => !!evt && evt.sender === currentWin()?.webContents;
  const rejectForeign = { ok: false, error: 'IPC call rejected: not from the Akhtar Agent window.' };
  const activeRuns = new Map();                                        
  app.activeRuns = activeRuns;                                                                                              

  const makeTakeoverControl = (conversationId) => {
    let requested = false;
    let paused = false;
    let waiters = [];
    const notify = (type, extra = {}) => currentWin()?.webContents.send('agent:event', { conversationId, type, ...extra });
    return {
      request() { requested = true; notify('takeover_requested'); return { requested: true, paused }; },
      async safePoint(label = 'safe point', signal) {
        if (!requested || signal?.aborted) return;
        if (!paused) { paused = true; notify('takeover_started', { label }); }
                                                                                          
        await new Promise((resolve) => {
          waiters.push(resolve);
          signal?.addEventListener('abort', resolve, { once: true });
        });
      },
      resume() {
        if (!requested && !paused) return { resumed: false };
        requested = false; paused = false;
        const pending = waiters; waiters = []; pending.forEach((r) => r());
        notify('takeover_ended');
        return { resumed: true };
      },
      cancel() { requested = false; paused = false; const pending = waiters; waiters = []; pending.forEach((r) => r()); },
      state() { return { requested, paused }; },
    };
  };

  const handle = (channel, fn) => ipcMain.handle(channel, async (evt, payload) => {
    if (!fromMainUi(evt)) return rejectForeign;
    try { return { ok: true, data: await fn(payload || {}) }; }
    catch (e) { logger.error(`IPC ${channel} failed`, e); return { ok: false, error: e.message }; }
  });

                                                
  handle('map:location', ({ latitude, longitude, accuracy, heading, speed }) => app.mapNavigation.setLocation({ latitude, longitude, accuracy, heading, speed }));
  handle('map:route', async ({ from, to, alternatives = true }) => {
    const routes = await app.mapNavigation.route(from, to, { alternatives });
    return { routes, traffic_realtime: false };
  });
  handle('map:navigationStart', ({ to, from = null }) => app.mapNavigation.start({ to, from }));
  handle('map:navigationStop', () => app.mapNavigation.stop());

                                            
  handle('preview:open', ({ workspaceId, path: filePath }) => { const ws = workspaceId ? app.repos.getWorkspace(workspaceId) : null; if (!ws) throw new Error('Open a workspace first.'); return app.preview.open(ws, filePath); });
  handle('preview:refresh', ({ workspaceId }) => { const ws = workspaceId ? app.repos.getWorkspace(workspaceId) : null; if (!ws) throw new Error('Open a workspace first.'); return app.preview.refresh(ws); });
  handle('preview:close', () => app.preview.close());
  handle('preview:inspect', (args = {}) => app.preview.inspect(args));

                                               
  handle('app:bootstrap', () => {
    const settings = app.settings.get();
    return {
      settings: { ...settings, providers: settings.providers.map((p) => publicProvider(p, app.secrets)) },
      workspaces: app.repos.listWorkspaces(),
      secretsSecure: app.secrets.isSecure(),
      skills: app.skills.list(),
      plugins: app.plugins,
      recovery: app.recoveryReport || { tasks: 0, toolCalls: 0 },
      resumableTasks: app.tasks.listResumable(8),
    };
  });
  handle('settings:update', (patch) => {
    const settings = app.settings.update(patch);
    return { ...settings, providers: settings.providers.map((p) => publicProvider(p, app.secrets)) };
  });
  handle('secrets:set', ({ providerId, apiKey }) => { app.secrets.set(`llm:${providerId}`, apiKey); return { saved: true }; });
  handle('secrets:has', ({ providerId }) => ({ hasKey: app.secrets.has(`llm:${providerId}`) }));

                                                                                        
  handle('secret:set', ({ name, value }) => { app.secrets.set(name, value); return { saved: true }; });
  handle('secret:has', ({ name }) => ({ has: app.secrets.has(name) }));

  handle('mcp:reset', () => { app.mcp.stopAll(); return { reset: true }; });

  handle('models:list', async ({ providerId }) => {
    const cfg = app.settings.getProvider(providerId);
    if (!cfg) throw new Error('Unknown provider.');
    const credential = ['supabase-openai','supabase-xkiro'].includes(cfg.type) ? (await app.auth.accessToken() || '') : (app.secrets.get(`llm:${providerId}`) || '');
    const provider = createProvider(cfg, credential);
    const models = await provider.getModels();
    if (models.length) app.settings.update({ providers: app.settings.get().providers.map((p) => (p.id === providerId ? { ...p, models } : p)) });
    return { models };
  });

                                                   
  handle('auth:session', () => app.auth.session());
  handle('auth:signup', ({ email, password, displayName }) => app.auth.signUp({ email, password, displayName }));
  handle('auth:signin', ({ email, password }) => app.auth.signIn({ email, password }));
  handle('auth:signout', () => app.auth.signOut());
  handle('billing:overview', () => app.billing.overview());
  handle('billing:checkout', ({ planId, method }) => app.billing.createCheckout({ planId, method }));
  handle('credits:status', () => app.credits.status());
  handle('credits:claim-login', () => app.credits.claimLoginRewards());

                                    
  handle('workspace:open', async () => {
    const res = await dialog.showOpenDialog(currentWin(), { properties: ['openDirectory', 'createDirectory'], title: 'Open Project Folder' });
    if (res.canceled || !res.filePaths[0]) return null;
    const root = res.filePaths[0];
    const existing = app.repos.findWorkspaceByRoot(root);
    const ws = existing || app.repos.createWorkspace({ name: path.basename(root), rootPath: root });
    app.repos.touchWorkspace(ws.id);
    return ws;
  });
  handle('workspace:list', () => app.repos.listWorkspaces());
  handle('workspace:rename', ({ id, name }) => app.repos.updateWorkspace(id, { name }));
  handle('workspace:delete', ({ id }) => { app.repos.deleteWorkspace(id); return { deleted: true }; });

                                        
  handle('conversation:create', ({ workspaceId = null, mode = 'assist', title = 'New chat' }) => app.repos.createConversation({ workspaceId, mode, title }));
  handle('conversation:list', ({ workspaceId = null }) => app.repos.listConversations(workspaceId));
  handle('conversation:messages', ({ conversationId }) => app.repos.listMessages(conversationId));
  handle('conversation:rename', ({ id, title }) => app.repos.updateConversation(id, { title }));
  handle('conversation:setMode', ({ id, mode }) => app.repos.updateConversation(id, { mode }));
  handle('conversation:delete', ({ id }) => { activeRuns.get(id)?.ctrl?.abort(); app.repos.deleteConversation(id); return { deleted: true }; });

                                                                  
  handle('task:list', ({ conversationId }) => app.tasks.listForConversation(conversationId));
  handle('task:resumable', ({ limit = 12 } = {}) => app.tasks.listResumable(limit));
  handle('task:dismiss-resume', ({ taskId }) => app.tasks.dismissResume(taskId));
  handle('task:events', ({ taskId }) => app.tasks.listEvents(taskId));
  handle('task:timeline', ({ taskId }) => app.tasks.timeline(taskId));
  handle('task:diagnose', ({ taskId }) => diagnoseTask(app.tasks, taskId));
  handle('task:fork', ({ taskId, eventId = null }) => {
    const task = app.tasks.get(taskId); if (!task) throw new Error('Task not found');
    const src = app.repos.getConversation(task.conversation_id); if (!src) throw new Error('Conversation not found');
    const conv = app.repos.createConversation({ workspaceId: task.workspace_id || null, mode: task.mode || 'assist', title: `Fork: ${task.title}`.slice(0,200) });
    const cutoff = eventId ? (app.db.get('SELECT created_at FROM task_events WHERE id = ? AND task_id = ?', [eventId, taskId])?.created_at || task.updated_at) : task.updated_at;
    const rows = app.db.all('SELECT * FROM messages WHERE conversation_id = ? AND created_at <= ? ORDER BY rowid', [task.conversation_id, cutoff]);
    for (const m of rows) app.repos.addMessage({ conversationId: conv.id, role: m.role, content: m.content || '', toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null, toolCallId: m.tool_call_id, toolName: m.tool_name, meta: { forkedFrom: taskId } });
    app.repos.addMessage({ conversationId: conv.id, role: 'user', content: `Forked from task "${task.title}"${eventId ? ` at timeline event ${eventId}` : ''}. Try a different approach from this point; do not modify the original run history.` });
    return conv;
  });
  handle('ghost:create', ({ workspaceId }) => { const ws=app.repos.getWorkspace(workspaceId); if(!ws) throw new Error('Workspace not found'); const g=app.ghost.create(ws); const ghostWs=app.repos.createWorkspace({ name: `${ws.name} · Ghost`, rootPath:g.rootPath }); const session=app.ghost.get(g.id); if(session) session.ghostWorkspaceId=ghostWs.id; return {...g, workspace:ghostWs}; });
  handle('ghost:diff', ({ ghostId }) => app.ghost.diff(ghostId));
  handle('ghost:apply', ({ ghostId, force = false }) => app.ghost.apply(ghostId, { force: force === true }));
  handle('ghost:discard', ({ ghostId }) => { const s=app.ghost.get(ghostId); const r=app.ghost.discard(ghostId); if(s?.ghostWorkspaceId) app.repos.deleteWorkspace(s.ghostWorkspaceId); return r; });
  handle('knowledge:index', ({ workspaceId, force = false }) => { const ws = app.repos.getWorkspace(workspaceId); if (!ws) throw new Error('Workspace not found'); return app.knowledge.index(ws, { force }); });
  handle('knowledge:search', ({ workspaceId, query, limit = 6 }) => { const ws = app.repos.getWorkspace(workspaceId); if (!ws) throw new Error('Workspace not found'); return app.knowledge.search(ws, query, { limit }); });
  handle('todo:list', ({ taskId }) => app.todo.list(taskId));
  handle('artifact:list', ({ workspaceId = null }) => app.artifacts.list(workspaceId));
  handle('artifact:open', ({ path: p }) => { shell.showItemInFolder(p); return { opened: true }; });
  handle('artifact:chart', ({ artifactId }) => { const a = app.artifacts.get(artifactId); if (!a || a.type !== 'chart') throw new Error('Chart artifact not found.'); const spec = JSON.parse(fs.readFileSync(a.path, 'utf8')); return { artifact: a, spec }; });
  handle('checkpoint:list', ({ workspaceId }) => app.checkpoints.listForWorkspace(workspaceId));
  handle('checkpoint:restore', ({ id }) => app.checkpoints.restore(id));
  handle('memory:list', ({ workspaceId = null }) => app.memory.list(workspaceId));
  handle('memory:remove', ({ id }) => { app.memory.remove(id); return { removed: true }; });
  handle('permission:grants', ({ workspaceId }) => app.permissions.listGrants(workspaceId));
  handle('permission:revoke', ({ workspaceId, category }) => { app.permissions.revoke(workspaceId, category); return { revoked: true }; });

                                    
  handle('schedule:list', ({ workspaceId = null }) => app.scheduler.list(workspaceId));
  handle('schedule:create', (args) => app.scheduler.create(args));
  handle('schedule:setEnabled', ({ id, enabled }) => app.scheduler.setEnabled(id, enabled));
  handle('schedule:remove', ({ id }) => { app.scheduler.remove(id); return { removed: true }; });

                                                 
  handle('browser:list', () => app.browserTabs.list());
  handle('browser:newTab', ({ url } = {}) => app.browserTabs.newTab(url));
  handle('browser:closeTab', ({ tabId }) => app.browserTabs.closeTab(tabId));
  handle('browser:switchTab', ({ tabId }) => app.browserTabs.switchTab(tabId));
  handle('browser:navigate', ({ tabId, url }) => app.browserTabs.navigate(tabId, url));
  handle('browser:back', ({ tabId }) => { app.browserTabs.goBack(tabId); return {}; });
  handle('browser:forward', ({ tabId }) => { app.browserTabs.goForward(tabId); return {}; });
  handle('browser:reload', ({ tabId }) => { app.browserTabs.reload(tabId); return {}; });
  handle('browser:setBounds', ({ bounds }) => { app.browserTabs.setBounds(bounds); return {}; });
  handle('browser:setVisible', ({ visible }) => { app.browserTabs.setVisible(visible); return {}; });
  handle('browser:ask-screen', async ({ tabId }) => {
    const id = tabId || app.browserTabs.activeId; if (!id) throw new Error('No browser tab is open.');
    const script = `new Promise((resolve)=>{const done=(e)=>{e.preventDefault();e.stopPropagation();const el=e.target;const r=el.getBoundingClientRect();document.removeEventListener('click',done,true);resolve({tag:el.tagName,role:el.getAttribute('role'),text:(el.innerText||el.textContent||'').trim().slice(0,500),aria:el.getAttribute('aria-label'),href:el.href||null,value:('value' in el?String(el.value).slice(0,300):null),rect:{x:r.x,y:r.y,width:r.width,height:r.height},url:location.href,title:document.title});};document.addEventListener('click',done,true);})`;
    return app.browserTabs.runScript(id, script);
  });

                                    
  handle('download:list', () => app.downloads.list());
  handle('download:pause', ({ id }) => { app.downloads.pause(id); return { ok: true }; });
  handle('download:resume', ({ id }) => { app.downloads.resume(id); return { ok: true }; });
  handle('download:cancel', ({ id }) => { app.downloads.cancel(id); return { ok: true }; });

                                                     
  ipcMain.on('permission:respond', (evt, msg) => { if (fromMainUi(evt) && msg) app.resolvePermission(msg.id, msg.decision); });

                                                                                         
  ipcMain.handle('agent:send', async (evt, { conversationId, workspaceId = null, mode = 'assist', text } = {}) => {
    if (!fromMainUi(evt)) return rejectForeign;
    if (!conversationId || typeof text !== 'string' || !text.trim()) return { ok: false, error: 'conversationId and text are required.' };
    if (!['chat', 'assist', 'agent'].includes(mode)) return { ok: false, error: `Invalid mode "${mode}".` };
    if (activeRuns.has(conversationId)) return { ok: false, error: 'A run is already in progress for this conversation.' };
    const ctrl = new AbortController();
    const takeover = makeTakeoverControl(conversationId);
    activeRuns.set(conversationId, { ctrl, takeover });
    const send = (ev) => currentWin()?.webContents.send('agent:event', { conversationId, ...ev });
    try {
      await app.agent.run({ conversationId, workspaceId, mode, text, signal: ctrl.signal, onEvent: send, takeover });
      return { ok: true };
    } catch (e) {
      logger.error('agent:send failed', e);
      send({ type: 'fatal_error', error: e.message });
      return { ok: false, error: e.message };
    } finally {
      takeover.cancel();
      activeRuns.delete(conversationId);
    }
  });
  ipcMain.handle('agent:resume', async (evt, { taskId } = {}) => {
    if (!fromMainUi(evt)) return rejectForeign;
    const task = taskId ? app.tasks.get(taskId) : null;
    if (!task) return { ok: false, error: 'Interrupted task not found.' };
    if (task.status !== 'interrupted') return { ok: false, error: `Task is not resumable (status: ${task.status}).` };
    const conversationId = task.conversation_id;
    if (activeRuns.has(conversationId)) return { ok: false, error: 'A run is already in progress for this conversation.' };
    const ctrl = new AbortController();
    const takeover = makeTakeoverControl(conversationId);
    activeRuns.set(conversationId, { ctrl, takeover, resumedTaskId: taskId });
    const send = (ev) => currentWin()?.webContents.send('agent:event', { conversationId, ...ev });
    try {
      await app.agent.run({ conversationId, workspaceId: task.workspace_id || null, mode: task.mode || 'assist', text: task.title || 'Resume interrupted task', signal: ctrl.signal, onEvent: send, takeover, resumeTaskId: taskId });
      return { ok: true };
    } catch (e) {
      logger.error('agent:resume failed', e);
      send({ type: 'fatal_error', error: e.message });
      return { ok: false, error: e.message };
    } finally {
      takeover.cancel();
      activeRuns.delete(conversationId);
    }
  });

  ipcMain.handle('agent:takeover', (evt, { conversationId } = {}) => {
    if (!fromMainUi(evt)) return rejectForeign;
    const run = activeRuns.get(conversationId);
    if (!run) return { ok: false, error: 'No run in progress.' };
    return { ok: true, data: run.takeover.request() };
  });
  ipcMain.handle('agent:continue', (evt, { conversationId } = {}) => {
    if (!fromMainUi(evt)) return rejectForeign;
    const run = activeRuns.get(conversationId);
    if (!run) return { ok: false, error: 'No run in progress.' };
    return { ok: true, data: run.takeover.resume() };
  });
  ipcMain.handle('agent:stop', (evt, { conversationId } = {}) => {
    if (!fromMainUi(evt)) return rejectForeign;
    const run = activeRuns.get(conversationId);
    if (!run) return { ok: false, error: 'No run in progress.' };
    run.takeover.cancel();
    run.ctrl.abort();
    return { ok: true };
  });
}

module.exports = { registerIpc };
