'use strict';
   
                                
                                                                    
                                                                  
   
const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE KEY REDACTED]'],
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***'],
  [/sk-(?:proj-|or-v1-|or-)?[A-Za-z0-9_-]{16,}/g, 'sk-***'],
  [/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh*_***'],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/g, 'xox*-***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1***'],
  [/((?:api[_-]?key|apikey|x-api-key|password|passwd|pwd|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[:=]\s*["']?)([^"'\s,;}]{4,})/gi, '$1***'],
];

function safeStringify(v) {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? '\n' + v.stack : ''}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function redact(input) {
  if (input === null || input === undefined) return input;
  let s = safeStringify(input);
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

function containsSecret(text) {
  if (typeof text !== 'string') return false;
  return SECRET_PATTERNS.some(([re]) => {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  });
}

class Logger {
  constructor() {
    this.dir = null;
    this.maxBytes = 5 * 1024 * 1024;
  }

  init(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  _write(file, level, message, data) {
    const extra = data === undefined ? '' : ' ' + redact(data);
    const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${redact(message)}${extra}\n`;
    if (!this.dir) { process.stdout.write(line); return; }
    const p = path.join(this.dir, file);
    try {
      const st = fs.statSync(p);
      if (st.size > this.maxBytes) fs.renameSync(p, p + '.1');
    } catch { /* file does not exist yet */ }
    fs.appendFile(p, line, () => {});
  }

  app(level, msg, data) { this._write('app.log', level, msg, data); }
  agent(level, msg, data) { this._write('agent.log', level, msg, data); }
  tools(level, msg, data) { this._write('tools.log', level, msg, data); }
  error(msg, err) { this._write('errors.log', 'error', msg, err); }
}

const logger = new Logger();
module.exports = { logger, redact, containsSecret };
