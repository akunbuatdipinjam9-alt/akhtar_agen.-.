'use strict';
const { app: electronApp, BrowserWindow } = require('electron');
const path = require('path');
const { Database } = require('../database/database');
const { Repos } = require('../database/repos');
const { SettingsStore } = require('./settings');
const { SecretStore } = require('./secrets');
const { logger } = require('../utils/logger');
const { PermissionManager } = require('../permissions/manager');
const { TodoManager } = require('../todo/manager');
const { MemoryManager } = require('../memory/manager');
const { SkillLoader } = require('../skills/loader');
const { CheckpointManager } = require('../checkpoints/manager');
const { ArtifactManager } = require('../artifacts/manager');
const { TaskManager } = require('../agent/task-manager');
const { buildRegistry } = require('../tools');
const { Agent } = require('../agent/agent');
const { GhostWorkspaceManager } = require('../agent/ghost-workspace');
const { createMainWindow } = require('./windows');
const { registerIpc } = require('./ipc');
const { setupDownloads } = require('./downloads');
const { BrowserTabManager } = require('./browser-tabs');
const { registerOsFsIpc } = require('./os-fs');
const { SchedulerManager } = require('../scheduler/manager');
const { loadPluginTools } = require('../plugins/loader');
const { McpManager } = require('../mcp/client');
const { ProjectKnowledge } = require('../knowledge/indexer');
const { BrowserVisionManager } = require('../browser/vision-manager');
const { BillingManager } = require('../billing/manager');
const { CreditManager } = require('../billing/credits');
const { SupabaseAuth } = require('../auth/supabase');
const { IslamicEventReminder } = require('./islamic-event-reminder');
const { runHealthCheck, recoverInterruptedTasks } = require('../agent/stability');
const { auditToolContracts } = require('../agent/tool-contracts');
const { MapNavigationManager } = require('./map-navigation');
const { PreviewService } = require('./preview-service');

                                                                                     
const app = {};
let bootstrapped = false;

                                                                                   
                                                                          
const gotSingleInstanceLock = electronApp.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  electronApp.quit();
} else {
  electronApp.on('second-instance', () => {
    const w = app.getWindow?.();
    if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else if (bootstrapped) openMainWindow();
  });
}

let mainWindow = null;

                                                                                              
function openMainWindow() {
  mainWindow = createMainWindow();
  app.browserTabs = new BrowserTabManager(mainWindow);
  mainWindow.on('closed', () => {
    app.browserTabs?.destroyAll();
    app.denyAllPendingPermissions?.();
    mainWindow = null;
  });
  return mainWindow;
}

async function bootstrap() {
  const userData = electronApp.getPath('userData');

  logger.init(path.join(userData, 'logs'));
  logger.app('info', 'Akhtar Agent starting', { version: electronApp.getVersion(), platform: process.platform });

  app.db = new Database();
  await app.db.init(path.join(userData, 'data', 'akhtar-agent.sqlite'));

  app.repos = new Repos(app.db);
  app.settings = new SettingsStore(app.db);
  app.secrets = new SecretStore(path.join(userData, 'data', 'secrets.enc.json'));
  app.todo = new TodoManager(app.db);
  app.memory = new MemoryManager(app.db);
  app.skills = new SkillLoader([path.join(__dirname, '..', '..', 'skills')]);
  app.checkpoints = new CheckpointManager(app.db);
  app.artifacts = new ArtifactManager(app.db);
  app.tasks = new TaskManager(app.db);
  app.recoveryReport = recoverInterruptedTasks(app.tasks);
  app.artifactsDir = path.join(userData, 'artifacts');
  require('fs').mkdirSync(app.artifactsDir, { recursive: true });

                                                                                    
                                                                           
  const bundledOsPath = path.join(__dirname, '..', '..', 'os', 'akhtar-os.html');
  app.osBundleUrl = require('fs').existsSync(bundledOsPath) ? require('url').pathToFileURL(bundledOsPath).toString() : null;

                                                                                                                      
  app.osFsRoot = path.join(userData, 'akhtar-os-fs');
  require('fs').mkdirSync(app.osFsRoot, { recursive: true });
  app.osPreloadPath = path.join(__dirname, '..', 'preload', 'os-preload.js');
  registerOsFsIpc(app);

  app.mcp = new McpManager(() => app.settings.get());
  app.knowledge = new ProjectKnowledge(app.db);
  app.registry = buildRegistry();

                                                                                               
                                                                                         
  const pluginsDir = path.join(__dirname, '..', '..', 'plugins');
  const { tools: pluginTools, loaded: loadedPlugins, errors: pluginErrors, sandboxes: pluginSandboxes } = await loadPluginTools([pluginsDir]);
  for (const tool of pluginTools) {
    try { app.registry.register(tool); }
    catch (e) { logger.app('error', `Skipped plugin tool "${tool?.name}": ${e.message}`); }
  }
  app.plugins = { loaded: loadedPlugins, errors: pluginErrors, sandboxes: pluginSandboxes };
                                                                                     
  electronApp.once('before-quit', () => { for (const p of pluginSandboxes) { try { p.kill(); } catch {} } });
                                                                                       
  app.toolContractAudit = auditToolContracts(app.registry);
  if (!app.toolContractAudit.ok) logger.app('error', 'Tool contract audit found issues', app.toolContractAudit);

  const pendingPermissions = new Map();
  app.getWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);

  app.permissions = new PermissionManager({
    db: app.db,
    request: (payload, signal) => new Promise((resolve) => {
      const win = app.getWindow();
                                                                                
      if (!win) { resolve('deny'); return; }
      const id = require('crypto').randomUUID();
      const onAbort = () => {
        finish('deny');
                                                                                             
        const w = app.getWindow(); if (w) w.webContents.send('permission:cancel', { id });
      };
      const finish = (decision) => {
        if (!pendingPermissions.has(id)) return;
        pendingPermissions.delete(id);
        signal?.removeEventListener('abort', onAbort);
        resolve(decision);
      };
      pendingPermissions.set(id, finish);
      if (signal?.aborted) { finish('deny'); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      win.webContents.send('permission:request', { id, ...payload });
    }),
  });
  const VALID_DECISIONS = new Set(['allow_once', 'allow_project', 'allow_always', 'deny']);
  app.resolvePermission = (id, decision) => {
    const finish = pendingPermissions.get(id);
    if (!finish) return false;
    finish(VALID_DECISIONS.has(decision) ? decision : 'deny');
    return true;
  };
  app.denyAllPendingPermissions = () => { for (const finish of [...pendingPermissions.values()]) finish('deny'); };

  app.ghost = new GhostWorkspaceManager();
  app.mapNavigation = new MapNavigationManager(app);
  app.preview = new PreviewService(app);
  app.agent = new Agent(app);
  app.scheduler = new SchedulerManager(app);
  app.islamicEventReminder = new IslamicEventReminder(app);

  openMainWindow();
  app.browserVision = new BrowserVisionManager(app);
  app.auth = new SupabaseAuth({ secrets: app.secrets });
  app.billing = new BillingManager({ auth: app.auth });
  app.credits = new CreditManager({ auth: app.auth });
  setupDownloads(app, mainWindow);                                              
  registerIpc(app, mainWindow);                                                               
  app.scheduler.start();
  app.islamicEventReminder.start();
  bootstrapped = true;

  app.health = runHealthCheck(app);
  logger.app('info', 'Akhtar Agent ready', { health: app.health.ok, recovered: app.recoveryReport, toolContracts: app.toolContractAudit });
}

electronApp.whenReady().then(() => { if (gotSingleInstanceLock && !bootstrapped) return bootstrap(); }).catch((e) => {
  logger.error('Fatal error during startup', e);
  electronApp.quit();
});

electronApp.on('window-all-closed', () => {
  app.db?.saveNow();
  if (process.platform !== 'darwin' && !app.islamicEventReminder?.enabled()) electronApp.quit();
});

electronApp.on('activate', () => {
                                                                                  
                                                                     
  if (BrowserWindow.getAllWindows().length === 0 && bootstrapped) openMainWindow();
});

electronApp.on('before-quit', () => { app.islamicEventReminder?.stop(); app.scheduler?.stop(); app.mcp?.stopAll(); app.db?.saveNow(); });

process.on('uncaughtException', (e) => logger.error('uncaughtException', e));
process.on('unhandledRejection', (e) => logger.error('unhandledRejection', e));
