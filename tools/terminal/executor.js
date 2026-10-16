'use strict';
   
                                                                              
                                                                         
  
                                                                                 
                                                                                   
                                                                              
   
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { stripAnsi, tail } = require('../../utils/misc');
const { redact } = require('../../utils/logger');

const IS_WIN = process.platform === 'win32';
const CMD_BUILTINS = new Set(['dir', 'type', 'echo', 'copy', 'move', 'del', 'erase', 'rd', 'rmdir', 'md', 'mkdir', 'ren', 'rename', 'ver', 'vol', 'cd', 'set', 'mklink']);
const CMD_UNSAFE = /[&|<>^%"!\r\n()]/;

function whichWin(prog) {
  if (/[\\/]/.test(prog)) return fs.existsSync(prog) ? prog : null;
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasExt = /\.[a-z0-9]+$/i.test(prog);
  for (const dir of (process.env.PATH || '').split(';').filter(Boolean)) {
    const candidates = hasExt ? [prog] : exts.map((e) => prog + e.toLowerCase());
    for (const c of candidates) {
      const full = path.join(dir, c);
      try { if (fs.statSync(full).isFile()) return full; } catch { /* next */ }
    }
  }
  return null;
}

function resolveSpawn(argv) {
  if (!IS_WIN) return { file: argv[0], args: argv.slice(1), verbatim: false };
  const prog = argv[0].toLowerCase();
  const resolved = CMD_BUILTINS.has(prog) ? null : whichWin(argv[0]);
  const needsCmd = CMD_BUILTINS.has(prog) || (resolved && /\.(cmd|bat)$/i.test(resolved));
  if (!needsCmd) return { file: resolved || argv[0], args: argv.slice(1), verbatim: false };
  for (const a of argv) {
    if (CMD_UNSAFE.test(a)) throw new Error(`Argument "${a}" contains characters that are unsafe for cmd.exe; rephrase the command.`);
  }
  const line = argv.map((a) => (/\s/.test(a) || a === '' ? `"${a}"` : a)).join(' ');
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

                                                                                
                                                                                     
function killGroup(pid, sig) {
  try { process.kill(-pid, sig); return true; }
  catch (e) {
    if (e && e.code === 'ESRCH') return false;                                               
    try { process.kill(pid, sig); } catch { /* already gone */ }
    return false;
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (IS_WIN) {
    try {
                                                                                                         
      const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      k.on('error', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
      k.on('close', () => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } });
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    return;
  }
                                                                               
                                                                             
                               
  killGroup(child.pid, 'SIGTERM');
  const t = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 3000);
  if (typeof t.unref === 'function') t.unref();
}

   
                                                                                             
   
function runCommand(argv, { cwd, timeoutMs = 120000, signal, onOutput, maxBuffer = 400000 }) {
  return new Promise((resolve, reject) => {
    let spec;
    try { spec = resolveSpawn(argv); } catch (e) { reject(e); return; }
    const started = Date.now();
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: process.env.CI || '1', npm_config_yes: 'false' };
    let child;
    try {
      child = spawn(spec.file, spec.args, {
        cwd, env, shell: false, windowsHide: true, detached: !IS_WIN,
        stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: spec.verbatim,
      });
    } catch (e) { reject(e); return; }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let pending = '';
    let flushTimer = null;
    const flush = () => { flushTimer = null; if (pending && onOutput) onOutput(redact(pending)); pending = ''; };
    const push = (stream) => (chunk) => {
      const text = stripAnsi(chunk.toString('utf8'));
      if (stream === 'out') stdout = (stdout + text).slice(-maxBuffer); else stderr = (stderr + text).slice(-maxBuffer);
      pending += text;
      if (!flushTimer) flushTimer = setTimeout(flush, 120);
    };
    child.stdout.on('data', push('out'));
    child.stderr.on('data', push('err'));

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onAbort = () => { cancelled = true; killTree(child); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    let settled = false;
    child.on('error', (err) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err.code === 'ENOENT' ? new Error(`Program not found: ${argv[0]}`) : err);
    });
    child.on('close', (code, sig) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      if (flushTimer) { clearTimeout(flushTimer); flush(); }
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        exit_code: code, signal: sig, timed_out: timedOut, cancelled,
        duration_ms: Date.now() - started,
        stdout: redact(tail(stdout, 12000)), stderr: redact(tail(stderr, 8000)),
      });
    });
  });
}

module.exports = { runCommand, resolveSpawn, killTree };
