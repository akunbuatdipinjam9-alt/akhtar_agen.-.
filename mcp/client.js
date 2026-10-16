'use strict';
                                                                      
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { resolveSpawn } = require('../tools/terminal/executor');

const MAX_LINE_BUFFER = 8 * 1024 * 1024;                                                          

class McpError extends Error {}

class StdioMcpConnection {
  constructor(config) {
    this.config = config;
    this.proc = null;
    this.buffer = '';
    this.pending = new Map();
    this.ready = null;
  }

  async start(signal) {
    if (this.ready) return this.ready;
    this.ready = this._start(signal).catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  async _start(signal) {
    if (this.proc) this.stop();                                                  
    const { command, args = [], cwd, env = {} } = this.config;
    if (!command || typeof command !== 'string') throw new McpError('MCP stdio server needs a command.');
    const argv = [command, ...(Array.isArray(args) ? args.map(String) : [])];
                                                                                     
                                                                                     
    const spec = resolveSpawn(argv);
    const proc = spawn(spec.file, spec.args, {
      cwd: cwd || undefined,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: spec.verbatim,
    });
    this.proc = proc;
    this.buffer = '';
                                                                                
                                                                     
    proc.stdin.on('error', (e) => { if (this.proc === proc) { this.proc = null; try { proc.kill(); } catch { /* gone */ } this._failAll(new McpError(`MCP server pipe closed: ${e.message}`)); } });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { if (this.proc === proc) this._onData(chunk); });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', () => {});                                                         
                                                                                                    
    proc.on('exit', (code, sig) => { if (this.proc === proc) { this.proc = null; this._failAll(new McpError(`MCP server exited (${code ?? sig ?? 'unknown'}).`)); } });
    proc.on('error', (e) => { if (this.proc === proc) { this.proc = null; this._failAll(new McpError(`MCP server failed: ${e.message}`)); } });

                                                                                                
    const onAbort = () => this.stop();
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      await this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'akhtar-agent', version: '1.0.0-alpha.1' },
      }, signal, 30000);
    } catch (e) {
      this.stop();
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    this.notify('notifications/initialized', {});
    return this;
  }

  _reply(id, payload) {
    try { if (this.proc?.stdin?.writable) this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n'); } catch { /* pipe gone */ }
  }

  _onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BUFFER && this.buffer.indexOf('\n') === -1) {
      this.buffer = '';
      this._failAll(new McpError('MCP server sent an oversized message without a newline.'));
      return;
    }
    let nl;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id == null) continue;
                                                                                              
      if (typeof msg.method === 'string') {
        if (msg.method === 'ping') this._reply(msg.id, { result: {} });
        else this._reply(msg.id, { error: { code: -32601, message: `Method not supported by client: ${msg.method}` } });
        continue;
      }
      const p = this.pending.get(String(msg.id));
      if (!p) continue;
      this.pending.delete(String(msg.id));
      clearTimeout(p.timer);
      if (msg.error) p.reject(new McpError(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  _failAll(err) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    this.ready = null;
  }

  request(method, params = {}, signal, timeoutMs = 60000) {
    if (!this.proc?.stdin?.writable) return Promise.reject(new McpError('MCP server is not running.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new McpError(`MCP ${method} timed out.`)); }, timeoutMs);
      const abort = () => { clearTimeout(timer); this.pending.delete(id); reject(new McpError('MCP request aborted.')); };
      if (signal?.aborted) return abort();
      if (signal) signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        timer,
        resolve: (v) => { if (signal) signal.removeEventListener('abort', abort); resolve(v); },
        reject: (e) => { if (signal) signal.removeEventListener('abort', abort); reject(e); },
      });
      try { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }
      catch (e) { this.pending.get(id)?.reject(new McpError(`MCP write failed: ${e.message}`)); this.pending.delete(id); clearTimeout(timer); }
    });
  }

  notify(method, params = {}) {
    try { if (this.proc?.stdin?.writable) this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); } catch { /* pipe gone */ }
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    if (proc && proc.exitCode === null && !proc.killed) { try { proc.kill(); } catch { /* already gone */ } }
    this._failAll(new McpError('MCP server stopped.'));
  }
}

class McpManager {
  constructor(getSettings) { this.getSettings = getSettings; this.connections = new Map(); }
  configs() { return this.getSettings()?.mcp?.servers || []; }
  listServers() { return this.configs().map(({ id, label, transport = 'stdio', command, enabled = true }) => ({ id, label: label || id, transport, command, enabled })); }
  config(id) { return this.configs().find((s) => s.id === id && s.enabled !== false) || null; }

  async connection(id, signal) {
    const cfg = this.config(id);
    if (!cfg) throw new McpError(`Unknown or disabled MCP server "${id}".`);
    if ((cfg.transport || 'stdio') !== 'stdio') throw new McpError('Akhtar Agent MCP v1 currently supports stdio servers only.');
    let conn = this.connections.get(id);
    if (!conn) { conn = new StdioMcpConnection(cfg); this.connections.set(id, conn); }
    await conn.start(signal);
    return conn;
  }

  async listTools(id, signal) {
    const c = await this.connection(id, signal);
    const result = await c.request('tools/list', {}, signal);
    return result?.tools || [];
  }

  async callTool(id, name, args, signal) {
    const c = await this.connection(id, signal);
    return c.request('tools/call', { name, arguments: args || {} }, signal, 120000);
  }

  stopAll() { for (const c of this.connections.values()) c.stop(); this.connections.clear(); }
}

module.exports = { McpManager, McpError };
