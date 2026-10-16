'use strict';
                                                                                                                 
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

const on = (channel, handler) => {
  const wrapped = (_evt, data) => handler(data);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('akhtar', {
  bootstrap: invoke('app:bootstrap'),
  mapLocation: invoke('map:location'),
  mapRoute: invoke('map:route'),
  mapNavigationStart: invoke('map:navigationStart'),
  mapNavigationStop: invoke('map:navigationStop'),
  onMapEvent: (cb) => on('map:event', cb),
  onLabEvent: (cb) => on('lab:event', cb),
  onPreviewEvent: (cb) => on('preview:event', cb),
  openPreview: invoke('preview:open'),
  refreshPreview: invoke('preview:refresh'),
  closePreview: invoke('preview:close'),
  inspectPreview: invoke('preview:inspect'),

  updateSettings: invoke('settings:update'),
  setApiKey: invoke('secrets:set'),
  hasApiKey: invoke('secrets:has'),
  setSecret: invoke('secret:set'),
  hasSecret: invoke('secret:has'),
  listModels: invoke('models:list'),
  resetMcp: invoke('mcp:reset'),
  authSession: invoke('auth:session'),
  authSignUp: invoke('auth:signup'),
  authSignIn: invoke('auth:signin'),
  authSignOut: invoke('auth:signout'),
  billingOverview: invoke('billing:overview'),
  createCheckout: invoke('billing:checkout'),
  creditsStatus: invoke('credits:status'),
  creditsClaimLogin: invoke('credits:claim-login'),

  openWorkspace: invoke('workspace:open'),
  listWorkspaces: invoke('workspace:list'),
  renameWorkspace: invoke('workspace:rename'),
  deleteWorkspace: invoke('workspace:delete'),

  createConversation: invoke('conversation:create'),
  listConversations: invoke('conversation:list'),
  listMessages: invoke('conversation:messages'),
  renameConversation: invoke('conversation:rename'),
  setConversationMode: invoke('conversation:setMode'),
  deleteConversation: invoke('conversation:delete'),

  listTasks: invoke('task:list'),
  listResumableTasks: invoke('task:resumable'),
  dismissResumableTask: invoke('task:dismiss-resume'),
  listTaskEvents: invoke('task:events'),
  getTaskTimeline: invoke('task:timeline'),
  diagnoseTask: invoke('task:diagnose'),
  forkTask: invoke('task:fork'),
  createGhostWorkspace: invoke('ghost:create'),
  diffGhostWorkspace: invoke('ghost:diff'),
  applyGhostWorkspace: invoke('ghost:apply'),
  discardGhostWorkspace: invoke('ghost:discard'),
  indexKnowledge: invoke('knowledge:index'),
  searchKnowledge: invoke('knowledge:search'),
  listTodos: invoke('todo:list'),
  listArtifacts: invoke('artifact:list'),
  openArtifact: invoke('artifact:open'),
  getChartArtifact: invoke('artifact:chart'),
  listCheckpoints: invoke('checkpoint:list'),
  restoreCheckpoint: invoke('checkpoint:restore'),
  listMemories: invoke('memory:list'),
  removeMemory: invoke('memory:remove'),
  listGrants: invoke('permission:grants'),
  revokeGrant: invoke('permission:revoke'),

  listSchedules: invoke('schedule:list'),
  createSchedule: invoke('schedule:create'),
  setScheduleEnabled: invoke('schedule:setEnabled'),
  removeSchedule: invoke('schedule:remove'),
  onScheduleEvent: (cb) => on('schedule:event', cb),

  listDownloads: invoke('download:list'),
  pauseDownload: invoke('download:pause'),
  resumeDownload: invoke('download:resume'),
  cancelDownload: invoke('download:cancel'),

  listBrowserTabs: invoke('browser:list'),
  newBrowserTab: invoke('browser:newTab'),
  closeBrowserTab: invoke('browser:closeTab'),
  switchBrowserTab: invoke('browser:switchTab'),
  navigateBrowserTab: invoke('browser:navigate'),
  browserBack: invoke('browser:back'),
  browserForward: invoke('browser:forward'),
  browserReload: invoke('browser:reload'),
  setBrowserBounds: invoke('browser:setBounds'),
  setBrowserVisible: invoke('browser:setVisible'),
  askBrowserScreen: invoke('browser:ask-screen'),
  onBrowserTabsChanged: (cb) => on('browser:tabs-changed', cb),

  sendMessage: invoke('agent:send'),
  resumeAgentTask: invoke('agent:resume'),
  stopAgent: invoke('agent:stop'),
  takeOverAgent: invoke('agent:takeover'),
  continueAgent: invoke('agent:continue'),
  respondPermission: (id, decision) => ipcRenderer.send('permission:respond', { id, decision }),

  onAgentEvent: (cb) => on('agent:event', cb),
  onPermissionRequest: (cb) => on('permission:request', cb),
  onPermissionCancel: (cb) => on('permission:cancel', cb),
  onDownloadEvent: (cb) => on('download:event', cb),
});
