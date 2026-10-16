'use strict';
   
                                     
  
                                                                               
                                                                             
                                                                             
  
                           
                                                                          
                                                                      
   
const fs = require('fs');
const path = require('path');
const { fork } = require('node:child_process');
const { logger } = require('../utils/logger');

const NAME_RE = /^[a-zA-Z0-9_.-]{1,80}$/;
const SECRET_RE = /^plugin:[a-zA-Z0-9_.-]{1,80}:[a-zA-Z0-9_.-]{1,80}$/;

function validateManifest(manifest, folderName) {
  if (!manifest?.name || typeof manifest.name !== 'string' || !NAME_RE.test(manifest.name)) throw new Error('plugin.json needs a safe "name" string.');
  if (manifest.name !== folderName) throw new Error('plugin name must match its folder name.');
  const main = manifest.main || 'index.js';
  if (typeof main !== 'string' || path.isAbsolute(main) || main.includes('..') || main.includes('/') || main.includes('\\')) throw new Error('plugin main must be a file inside the plugin folder.');
  const secrets = manifest.secrets || [];
  if (!Array.isArray(secrets) || secrets.some((s) => typeof s !== 'string' || !SECRET_RE.test(s) || !s.startsWith(`plugin:${manifest.name}:`))) {
    throw new Error('plugin secrets must be scoped names like "plugin:<name>:<key>".');
  }
  return { ...manifest, main, secrets: [...new Set(secrets)] };
}

function discoverPlugins(dirs) {
  const found = [];
  for (const dir of (Array.isArray(dirs) ? dirs : [dirs])) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink?.()) continue;
      const pluginDir = path.join(dir, entry.name);
      const manifestPath = path.join(pluginDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), entry.name);
        const mainFile = path.join(pluginDir, manifest.main);
        const realDir = fs.realpathSync(pluginDir);
        const realMain = fs.realpathSync(mainFile);
        if (!realMain.startsWith(realDir + path.sep)) throw new Error('plugin main escapes its plugin folder.');
        if (!fs.statSync(realMain).isFile()) throw new Error('plugin main is not a regular file.');
        found.push({ id: entry.name, dir: realDir, manifest, mainFile: realMain });
      } catch (e) {
        logger.app('error', `Skipped plugin folder "${entry.name}": ${e.message}`);
      }
    }
  }
  return found;
}

function cleanEnv() {
                                                                          
  const keep = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];
  const env = { ELECTRON_RUN_AS_NODE: '1', AKHTAR_PLUGIN_SANDBOX: '1' };
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  return env;
}

function startSandbox(p) {
  const host = path.join(__dirname, 'sandbox-host.js');
  const child = fork(host, [p.mainFile], {
    cwd: p.dir,
    env: cleanEnv(),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [
      '--permission',
      `--allow-fs-read=${p.dir}`,
      `--allow-fs-read=${host}`,
    ],
  });
  return child;
}

function loadOnePlugin(p, { startupTimeoutMs = 5000, callTimeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = startSandbox(p);
    let settled = false;
    let seq = 0;
    const pending = new Map();
    const die = (err) => {
      for (const x of pending.values()) { clearTimeout(x.timer); x.reject(err); }
      pending.clear();
    };
    const startup = setTimeout(() => { child.kill(); reject(new Error('Plugin sandbox startup timed out.')); }, startupTimeoutMs);
    child.once('error', (e) => { if (!settled) { clearTimeout(startup); reject(e); } die(e); });
    child.once('exit', (code) => { const e = new Error(`Plugin sandbox exited (${code}).`); if (!settled) { clearTimeout(startup); reject(e); } die(e); });
    child.on('message', (m) => {
      if (m?.type === 'fatal' && !settled) { clearTimeout(startup); child.kill(); reject(new Error(m.error)); }
      if (m?.type === 'ready' && !settled) {
        settled = true; clearTimeout(startup);
        const tools = (m.tools || []).map((d) => ({
          ...d,
          plugin: p.manifest.name,
          async execute(args, ctx) {
            const id = `${process.pid}:${Date.now()}:${++seq}`;
            const secrets = {};
            for (const key of p.manifest.secrets) {
              const v = ctx?.secrets?.get?.(key);
              if (v != null) secrets[key] = v;
            }
            return new Promise((res, rej) => {
              const timer = setTimeout(() => { pending.delete(id); rej(new Error(`Plugin tool timed out after ${callTimeoutMs}ms.`)); }, callTimeoutMs);
              pending.set(id, { resolve: res, reject: rej, timer });
              child.send({ type: 'execute', id, name: d.name, args: args || {}, secrets });
            });
          },
        }));
        resolve({ tools, child });
      }
      if (m?.type === 'result') {
        const q = pending.get(m.id); if (!q) return;
        pending.delete(m.id); clearTimeout(q.timer);
        m.ok ? q.resolve(m.value) : q.reject(new Error(m.error || 'Plugin failed.'));
      }
    });
  });
}

                                                                                 
async function loadPluginTools(dirs, opts = {}) {
  const tools = [], loaded = [], errors = [], sandboxes = [];
  for (const p of discoverPlugins(dirs)) {
    try {
      const r = await loadOnePlugin(p, opts);
      tools.push(...r.tools); sandboxes.push(r.child);
      loaded.push({ id: p.id, name: p.manifest.name, version: p.manifest.version || null, description: p.manifest.description || null, toolCount: r.tools.length, sandbox: 'node-permission-v1' });
      logger.app('info', `Loaded restricted plugin "${p.manifest.name}" (${r.tools.length} tool(s))`);
    } catch (e) {
      logger.app('error', `Failed to load plugin "${p.id}": ${e.message}`);
      errors.push({ id: p.id, error: e.message });
    }
  }
  return { tools, loaded, errors, sandboxes };
}

module.exports = { discoverPlugins, loadPluginTools, loadOnePlugin, validateManifest, cleanEnv };
