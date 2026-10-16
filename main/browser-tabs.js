'use strict';
   
                                                                           
                                                                        
                                                                       
                                                                     
  
                                                                         
                                                                
  
                                                                        
                                                                      
                                                                          
                                                                           
   
const { WebContentsView } = require('electron');
const { uid } = require('../utils/misc');
const { logger } = require('../utils/logger');

const MAX_TABS = 12;

   
                                                                                       
                                                                                 
                                                                  
   
function normalizeWebUrl(url) {
  let target = String(url || '').trim();
  if (!target || target === 'about:blank') return 'about:blank';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
  let u;
  try { u = new URL(target); } catch { throw new Error(`Invalid URL "${url}".`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Only http/https URLs can be opened in a browser tab (got ${u.protocol}).`);
  return u.toString();
}

                                                                             
function samePlace(a, b) {
  try {
    const x = new URL(a); const y = new URL(b);
    if (x.protocol === 'file:' || y.protocol === 'file:') return x.protocol === y.protocol && x.pathname === y.pathname;
    return x.origin === y.origin;
  } catch { return false; }
}

class BrowserTabManager {
                                                      
  constructor(win) {
    this.win = win;
    this.tabs = new Map();                                           
    this.order = [];                          
    this.activeId = null;
    this.bounds = null;                                 
    this.visible = false;
    this.named = new Map();                                                                             
  }

  list() {
    return this.order.map((id) => this._publicTab(this.tabs.get(id)));
  }

  _publicTab(t) {
    return { id: t.id, title: t.title, url: t.url, loading: t.loading, active: t.id === this.activeId };
  }

  _alive() { return !!this.win && !this.win.isDestroyed(); }

  _emitTabsChanged() {
                                                                                
    if (this._alive()) this.win.webContents.send('browser:tabs-changed', this.list());
  }

                                                                                           
  isPrivilegedSender(wc) {
    for (const t of this.tabs.values()) if (t.privileged && t.view.webContents === wc) return true;
    return false;
  }

  _get(id) {
    const t = this.tabs.get(id || this.activeId);
    if (!t) throw new Error(id ? `Tab "${id}" not found.` : 'No browser tab is open. Call browser.new_tab first.');
    return t;
  }

  newTab(url, opts = {}) {
    if (this.tabs.size >= MAX_TABS) throw new Error(`Too many tabs open (max ${MAX_TABS}). Close one first.`);
    const privileged = !!opts.preload;
                                                                                             
                                                        
    const target = privileged ? String(url) : (url ? normalizeWebUrl(url) : null);
    const id = uid();
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: true, preload: opts.preload },
    });
    const t = { id, view, title: 'New Tab', url: target || 'about:blank', loading: false, privileged, homeUrl: privileged ? target : null };
    this.tabs.set(id, t);
    this.order.push(id);

    const wc = view.webContents;
    wc.on('did-start-loading', () => { t.loading = true; this._emitTabsChanged(); });
    wc.on('did-stop-loading', () => { t.loading = false; t.url = wc.getURL(); this._emitTabsChanged(); });
    wc.on('page-title-updated', (_e, title) => { t.title = title; this._emitTabsChanged(); });
    if (privileged) {
                                                                                
                                                             
      const guard = (e, navUrl) => { if (!samePlace(navUrl, t.homeUrl)) { e.preventDefault(); logger.app('warn', 'Blocked privileged tab navigation', { url: navUrl }); } };
      wc.on('will-navigate', guard);
      wc.on('will-redirect', guard);
      wc.setWindowOpenHandler(({ url: openUrl }) => {
        try { this.newTab(openUrl); } catch (e) { logger.error('Blocked popup from privileged tab', e); }
        return { action: 'deny' };
      });
    } else {
      wc.setWindowOpenHandler(({ url: openUrl }) => {
        try { this.navigate(id, openUrl); } catch (e) { logger.error('Blocked popup navigation', e); }
        return { action: 'deny' };
      });
    }

    this.switchTab(id);
    if (target) wc.loadURL(target).catch((e) => logger.error('Tab load failed', e));
    this._emitTabsChanged();
    return this._publicTab(t);
  }

  closeTab(id) {
    const t = this._get(id);
    for (const [name, tabId] of this.named) if (tabId === t.id) this.named.delete(name);
    if (this.activeId === t.id && this._alive()) { try { this.win.contentView.removeChildView(t.view); } catch { /* window going away */ } }
                                                                                        
                                                                             
    try { if (!t.view.webContents.isDestroyed()) t.view.webContents.close(); } catch { /* already gone */ }
    this.tabs.delete(t.id);
    this.order = this.order.filter((x) => x !== t.id);
    if (this.activeId === t.id) {
      this.activeId = null;
      if (this.order.length) this.switchTab(this.order[this.order.length - 1]);
    }
    this._emitTabsChanged();
    return { closed: true };
  }

  switchTab(id) {
    const t = this._get(id);
    if (this.activeId && this.activeId !== t.id && this._alive()) {
      const prev = this.tabs.get(this.activeId);
      if (prev) this.win.contentView.removeChildView(prev.view);
    }
    this.activeId = t.id;
    if (this.visible && this._alive()) {
      this.win.contentView.addChildView(t.view);
      if (this.bounds) t.view.setBounds(this.bounds);
    }
    this._emitTabsChanged();
    return this._publicTab(t);
  }

  navigate(id, url) {
    const t = this._get(id);
    if (t.privileged) throw new Error('This tab holds a privileged file-system bridge and cannot be navigated elsewhere. Use browser.new_tab instead.');
    const target = normalizeWebUrl(url);
    t.url = target;
    t.view.webContents.loadURL(target).catch((e) => logger.error('Tab navigation failed', e));
    return { navigating: true, url: target };
  }

  goBack(id) {
    const wc = this._get(id).view.webContents;
    const nav = wc.navigationHistory;
    if (nav) { if (nav.canGoBack()) nav.goBack(); }
    else if (wc.canGoBack()) wc.goBack();                           
  }
  goForward(id) {
    const wc = this._get(id).view.webContents;
    const nav = wc.navigationHistory;
    if (nav) { if (nav.canGoForward()) nav.goForward(); }
    else if (wc.canGoForward()) wc.goForward();                           
  }
  reload(id) { this._get(id).view.webContents.reload(); }

  history(id) {
    const wc = this._get(id).view.webContents;
    const nav = wc.navigationHistory;
    if (nav && typeof nav.getAllEntries === 'function') {
      const entries = nav.getAllEntries().map((e, index) => ({ index, url: e.url || e.virtualUrl || null, title: e.title || null }));
      return { currentIndex: nav.getActiveIndex?.() ?? null, canGoBack: nav.canGoBack(), canGoForward: nav.canGoForward(), entries };
    }
    return { currentIndex: null, canGoBack: !!wc.canGoBack?.(), canGoForward: !!wc.canGoForward?.(), entries: [] };
  }

  async setFileInputFiles(id, selector, files) {
    const wc = this._get(id).view.webContents;
    const dbg = wc.debugger;
    let attachedHere = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true; }
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0, pierce: true });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`File input not found for selector ${selector}`);
      await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files });
      return { ok: true, selector, fileCount: files.length };
    } finally {
      if (attachedHere && dbg.isAttached()) { try { dbg.detach(); } catch { /* ignore */ } }
    }
  }

  async downloadUrl(id, url, savePath, timeoutMs = 60000) {
    const wc = this._get(id).view.webContents;
    const ses = wc.session;
    return await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); ses.removeListener('will-download', onDownload); };
      const onDownload = (_event, item, sourceWc) => {
        if (sourceWc && sourceWc !== wc) return;
        item.setSavePath(savePath);
        item.once('done', (_e, state) => {
          cleanup();
          if (state === 'completed') resolve({ ok: true, path: savePath, url: item.getURL(), filename: item.getFilename(), totalBytes: item.getTotalBytes() });
          else reject(new Error(`Download ended with state ${state}.`));
        });
      };
      ses.on('will-download', onDownload);
      timer = setTimeout(() => { cleanup(); reject(new Error('Download timed out.')); }, timeoutMs);
      try { wc.downloadURL(url); } catch (e) { cleanup(); reject(e); }
    });
  }

                                                                                                                    
  setBounds(rect) {
    this.bounds = rect;
    const t = this.activeId && this.tabs.get(this.activeId);
    if (t && this.visible) t.view.setBounds(rect);
  }

  setVisible(visible) {
    this.visible = visible;
    const t = this.activeId && this.tabs.get(this.activeId);
    if (!t || !this._alive()) return;
    if (visible) {
      this.win.contentView.addChildView(t.view);
      if (this.bounds) t.view.setBounds(this.bounds);
    } else {
      this.win.contentView.removeChildView(t.view);
    }
  }

  async waitForLoad(id, timeoutMs = 15000) {
    const t = this._get(id);
    if (!t.loading) return;
    const wc = t.view.webContents;
    await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); wc.removeListener('did-stop-loading', done); wc.removeListener('destroyed', done); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      wc.once('did-stop-loading', done);
      wc.once('destroyed', done);                            
    });
  }

  async runScript(id, script) {
    const t = this._get(id);
    try {
      return await t.view.webContents.executeJavaScript(script, true);
    } catch (e) {
      logger.error('browser runScript failed', e);
      throw new Error(`Could not run script in the page: ${e.message}`);
    }
  }

  async sendKey(id, event) {
    this._get(id).view.webContents.sendInputEvent(event);
  }

                                                                                                                              
  sendInputEvent(id, event) {
    this._get(id).view.webContents.sendInputEvent(event);
  }

  getViewportSize(id) {
    const t = this._get(id);
    const b = t.view.getBounds();
    return { width: b.width, height: b.height };
  }

  async capturePng(id) {
    const t = this._get(id);
    const image = await t.view.webContents.capturePage();
    return image.toPNG();
  }

  destroyAll() {
    for (const id of [...this.order]) { try { this.closeTab(id); } catch { /* already gone */ } }
  }

                                                                                                                                                                                                                                              
  ensureNamedTab(name, url, opts = {}) {
    const existingId = this.named.get(name);
    if (existingId && this.tabs.has(existingId)) return this.tabs.get(existingId).id;
    const t = this.newTab(url, opts);
    this.named.set(name, t.id);
    return t.id;
  }
}

module.exports = { BrowserTabManager, normalizeWebUrl, samePlace };
