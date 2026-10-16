'use strict';
   
                                                        
                                                                                      
                                            
                                                                                            
   
const path = require('path');

const SHELL_META = /[|&;<>`\n\r]|\$\(|\$\{/;

function tokenize(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) { cur += cmd[++i]; }
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } }
    else { cur += c; has = true; }
  }
  if (quote) throw new Error('Unbalanced quotes in command.');
  if (cur || has) out.push(cur);
  return out;
}

const progName = (argv0) => path.basename(String(argv0)).toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');

const BLOCKED_PROGS = new Set(['mkfs', 'format', 'diskpart', 'fdisk', 'parted', 'shutdown', 'reboot', 'halt', 'poweroff', 'bcdedit', 'vssadmin', 'sudo', 'su', 'doas', 'runas', 'pkexec', 'dd', 'wipefs', 'shred', 'cipher', 'sfc', 'dism', 'crontab', 'schtasks', 'launchctl', 'systemctl', 'sc', 'netsh', 'iptables', 'ufw', 'useradd', 'userdel', 'usermod', 'passwd', 'net']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh', 'wsl', 'osascript', 'eval', 'exec', 'xargs', 'nohup', 'env', 'start', 'open', 'explorer', 'rundll32', 'mshta', 'wscript', 'cscript', 'regsvr32']);
const READ_ONLY = new Set(['ls', 'dir', 'pwd', 'cat', 'type', 'head', 'tail', 'echo', 'where', 'which', 'whoami', 'date', 'tree', 'grep', 'rg', 'findstr', 'wc', 'file', 'stat', 'du', 'df', 'hostname', 'uname', 'ver', 'less', 'more', 'sort', 'uniq', 'diff', 'fc', 'cd']);
const FILE_MUTATORS = new Set(['cp', 'mv', 'mkdir', 'md', 'touch', 'copy', 'move', 'ren', 'rename', 'xcopy', 'ln', 'unzip', 'tar', 'zip', '7z']);
const DESTROYERS = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'unlink']);
const PERMISSION_CHANGERS = new Set(['chmod', 'chown', 'chgrp', 'icacls', 'takeown', 'attrib', 'cacls', 'setfacl']);
const KILLERS = new Set(['kill', 'killall', 'pkill', 'taskkill', 'stop-process']);
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx']);
const RUNTIMES = new Set(['node', 'python', 'python3', 'py', 'deno', 'ruby', 'php', 'java', 'go', 'cargo', 'dotnet', 'tsc', 'tsx', 'ts-node', 'electron', 'jest', 'vitest', 'mocha', 'eslint', 'prettier', 'vite', 'webpack', 'next', 'pip', 'pip3', 'poetry', 'uv', 'make', 'cmake', 'gradle', 'mvn']);
const GIT_SAFE = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'reflog', 'grep', 'whatchanged', 'ls-tree', 'cat-file', 'config']);
const GIT_DANGEROUS = new Set(['clean', 'filter-branch', 'filter-repo', 'gc', 'prune', 'rebase', 'reflog-expire', 'update-ref', 'rm']);
const VERSION_FLAGS = new Set(['-v', '--version', '-V', 'version', '--help', '-h', 'help']);

const r = (level, reason) => ({ level, reason });

function isRootLike(arg) {
  const a = arg.replace(/["']/g, '');
  return /^(\/|~|~\/|\/\*|\*|[a-z]:\\?|[a-z]:\\\*|\.\.?\/?\*?|\$home|%userprofile%|\\)$/i.test(a) || /^\/(bin|boot|etc|lib|usr|var|sys|proc|home|root|system)(\/|$)/i.test(a) || /^[a-z]:\\(windows|program files|users)(\\|$)/i.test(a);
}

function escapesWorkspace(args, cwd, root) {
  if (!root) return null;
  for (const a of args) {
    if (a.startsWith('-') || a.startsWith('/') && a.length <= 3 && process.platform === 'win32') continue;
    const looksPath = /^([a-z]:[\\/]|[\\/]|~|\.\.)/i.test(a) || a.includes('../') || a.includes('..\\');
    if (!looksPath) continue;
    const expanded = a.startsWith('~') ? path.join(require('os').homedir(), a.slice(1)) : a;
    const abs = path.resolve(cwd, expanded);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return a;
  }
  return null;
}

   
                                                                                                
   
function classify(command, { cwd, root } = {}) {
  const raw = String(command || '').trim();
  if (!raw) return r('BLOCKED', 'Empty command.');
  if (raw.length > 4000) return r('BLOCKED', 'Command too long.');
  if (SHELL_META.test(raw)) return r('BLOCKED', 'Shell operators (| & ; < > ` $( ) and newlines are not supported. Run one command at a time without pipes or redirects.');
  let argv;
  try { argv = tokenize(raw); } catch (e) { return r('BLOCKED', e.message); }
  if (!argv.length) return r('BLOCKED', 'Empty command.');
  const prog = progName(argv[0]);
  const args = argv.slice(1);
  const low = args.map((a) => a.toLowerCase());
  const has = (...flags) => low.some((a) => flags.includes(a));
  const result = (level, reason) => ({ level, reason, argv });

  if (BLOCKED_PROGS.has(prog)) return result('BLOCKED', `"${prog}" is blocked (system-level or privilege escalation).`);
  if (prog === 'reg' && has('delete', 'add', 'import')) return result('BLOCKED', 'Registry modification is blocked.');
  if (prog === 'curl' || prog === 'wget') {
    if (low.some((a) => /^(-o|--output|-O)$/.test(a))) return result('CAUTION', 'Downloads a file.');
    return result('CAUTION', 'Network request.');
  }
  if (SHELLS.has(prog)) return result('DANGEROUS', `"${prog}" can execute arbitrary commands.`);

  let level;
  let reason;
  if (DESTROYERS.has(prog)) {
    const recursive = low.some((a) => /^-[a-z]*r[a-z]*$/i.test(a) || a === '--recursive' || a === '/s');
    if (args.some(isRootLike)) return result('BLOCKED', 'Deleting a root, home or system location is blocked.');
    level = 'DANGEROUS'; reason = recursive ? 'Recursive delete.' : 'Deletes files.';
  } else if (PERMISSION_CHANGERS.has(prog)) { level = 'DANGEROUS'; reason = 'Changes file permissions/ownership.'; }
  else if (KILLERS.has(prog)) { level = 'DANGEROUS'; reason = 'Terminates processes.'; }
  else if (prog === 'find') {
    if (has('-delete', '-exec', '-execdir', '-ok')) { level = 'DANGEROUS'; reason = 'find with -delete/-exec.'; } else { level = 'SAFE'; reason = 'Read-only search.'; }
  } else if (prog === 'robocopy') { level = has('/mir', '/purge') ? 'DANGEROUS' : 'CAUTION'; reason = 'Copies files.'; }
  else if (prog === 'git') {
    const sub = low.find((a) => !a.startsWith('-')) || '';
                                                                                                 
    if (low.some((a) => a === '-c' || a.startsWith('-c') && a.length > 2 || a.startsWith('--config-env') || a === '--textconv' || a === '--ext-diff' || a.startsWith('--exec-path') || a.startsWith('--upload-pack') || a.startsWith('--receive-pack'))) { level = 'CAUTION'; reason = 'git with config override / external program options.'; }
    else if (sub === 'push' && low.some((a) => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a === '--delete' || a === '--mirror')) { level = 'DANGEROUS'; reason = 'Force push / remote deletion.'; }
    else if (sub === 'reset' && has('--hard')) { level = 'DANGEROUS'; reason = 'Discards local changes.'; }
    else if ((sub === 'checkout' || sub === 'restore') && (has('--', '.') || has('-f', '--force'))) { level = 'DANGEROUS'; reason = 'Discards working-tree changes.'; }
    else if (sub === 'branch' && has('-d', '-D', '--delete')) { level = 'DANGEROUS'; reason = 'Deletes a branch.'; }
    else if (sub === 'stash' && has('drop', 'clear')) { level = 'DANGEROUS'; reason = 'Deletes stashes.'; }
    else if (GIT_DANGEROUS.has(sub)) { level = 'DANGEROUS'; reason = `git ${sub} rewrites or deletes history/files.`; }
    else if (sub === 'config' && !has('--get', '--list', '-l', '--get-all')) { level = 'CAUTION'; reason = 'Changes git config.'; }
    else if (GIT_SAFE.has(sub) || (sub === 'branch' && args.length <= 2) || (sub === 'remote' && (has('-v') || args.length === 1)) || (sub === 'stash' && has('list')) || (sub === 'tag' && args.length === 1)) { level = 'SAFE'; reason = 'Read-only git command.'; }
    else { level = 'CAUTION'; reason = `git ${sub || ''} changes repository state.`.trim(); }
  } else if (PKG.has(prog)) {
    const sub = low[0] || '';
    if (['publish', 'unpublish', 'deprecate', 'owner', 'token', 'login', 'logout', 'adduser', 'access', 'dist-tag'].includes(sub)) { level = 'DANGEROUS'; reason = `${prog} ${sub} affects the registry/account.`; }
    else if (args.length === 1 && VERSION_FLAGS.has(args[0])) { level = 'SAFE'; reason = 'Version/help.'; }
    else if (['ls', 'list', 'view', 'info', 'outdated', 'why', 'explain', 'audit'].includes(sub) && !has('fix')) { level = 'SAFE'; reason = 'Read-only package query.'; }
    else if (sub === 'config' || sub === 'c') { level = 'CAUTION'; reason = 'npm config may reveal or change credentials.'; }
    else { level = 'CAUTION'; reason = prog.endsWith('x') ? 'Downloads and runs a package.' : 'Installs packages or runs project scripts.'; }
  } else if (RUNTIMES.has(prog)) {
    if (args.length === 1 && VERSION_FLAGS.has(args[0])) { level = 'SAFE'; reason = 'Version/help.'; }
    else if (['pip', 'pip3'].includes(prog) && ['list', 'show', 'freeze'].includes(low[0])) { level = 'SAFE'; reason = 'Read-only package query.'; }
    else if ((prog === 'node' || prog.startsWith('python') || prog === 'py') && has('-e', '-c', '--eval', '-p', '--print')) { level = 'CAUTION'; reason = 'Evaluates inline code.'; }
    else { level = 'CAUTION'; reason = 'Runs code.'; }
  } else if (FILE_MUTATORS.has(prog)) { level = 'CAUTION'; reason = 'Creates, copies or moves files.'; }
  else if (READ_ONLY.has(prog)) { level = 'SAFE'; reason = 'Read-only command.'; }
  else if (prog === 'printenv' || prog === 'set') { level = 'CAUTION'; reason = 'Prints environment variables (may include secrets).'; }
  else { level = 'CAUTION'; reason = `Unknown program "${prog}".`; }

  const escaped = escapesWorkspace(args, cwd || root || process.cwd(), root);
  if (escaped && level !== 'BLOCKED') {
    if (level === 'SAFE' || level === 'CAUTION') { level = 'DANGEROUS'; reason = `Touches a path outside the workspace (${escaped}). ${reason}`; }
  }
  return result(level, reason);
}

module.exports = { tokenize, classify, progName };
