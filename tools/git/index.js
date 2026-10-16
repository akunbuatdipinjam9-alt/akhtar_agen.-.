'use strict';
   
                                                                          
                                                                    
                                                                        
                                                                   
                                       
   
const { LEVEL } = require('../../permissions/levels');
const { runCommand } = require('../terminal/executor');
const { resolveInWorkspace, relPath } = require('../filesystem/pathguard');
const { truncate } = require('../../utils/misc');

const MAX_DIFF = 12000;

                                                                                        
                                                                                
                                                                                         
const SAFE_GIT_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'protocol.ext.allow=never'];
const NO_HOOKS = ['-c', `core.hooksPath=${require('os').devNull}`];

async function runGit(argv, ctx, timeoutMs, { allowHooks = false } = {}) {
  const root = ctx.workspace.root_path;
  const safe = allowHooks ? SAFE_GIT_CONFIG : [...SAFE_GIT_CONFIG, ...NO_HOOKS];
  return runCommand(['git', ...safe, ...argv], { cwd: root, timeoutMs: timeoutMs || (ctx.settings.agent.toolTimeoutSec * 1000), signal: ctx.signal });
}

   
                                                                          
                                                                                
                                                                           
   
function assertBranchName(name) {
  const n = String(name || '');
  if (!n || n.startsWith('-') || n.length > 250 || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(n) || n.includes('..') || n.includes('@{') || n.endsWith('.lock') || n.endsWith('/') || n.endsWith('.') || n.startsWith('/') || n.includes('//')) {
    throw new Error(`Invalid branch name "${name}".`);
  }
  return n;
}

function assertGitOk(res, action) {
  if (res.exit_code !== 0) {
    if (/not a git repository/i.test(res.stderr)) throw new Error('This workspace is not a git repository. Use git.init first.');
    throw new Error(`git ${action} failed (exit ${res.exit_code}): ${truncate(res.stderr || res.stdout, 800)}`);
  }
}

function toWorkspaceRelPaths(ctx, paths) {
  const root = ctx.workspace.root_path;
  return paths.map((p) => relPath(root, resolveInWorkspace(root, p)));
}

function parseStatus(stdout) {
  const lines = stdout.split('\n').filter(Boolean);
  let branch = null, ahead = 0, behind = 0;
  const staged = [], unstaged = [], untracked = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const info = line.slice(3);
      const m = info.match(/^(\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?$/);
      branch = m ? m[1] : info;
      if (m && m[3]) {
        const a = m[3].match(/ahead (\d+)/); if (a) ahead = +a[1];
        const b = m[3].match(/behind (\d+)/); if (b) behind = +b[1];
      }
      continue;
    }
    const x = line[0], y = line[1], file = line.slice(3);
    if (x === '?' && y === '?') { untracked.push(file); continue; }
    if (x !== ' ' && x !== '?') staged.push({ file, status: x });
    if (y !== ' ') unstaged.push({ file, status: y });
  }
  return { branch, ahead, behind, staged, unstaged, untracked, clean: !staged.length && !unstaged.length && !untracked.length };
}

function parseLog(stdout) {
  return stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, author, date, ...rest] = line.split('\x1f');
    return { hash, author, date, message: rest.join('\x1f') };
  });
}

const readBase = { group: 'git', permission: LEVEL.READ, category: 'git.read', requiresWorkspace: true };
const writeBase = { group: 'git', permission: LEVEL.WRITE, category: 'git.write', requiresWorkspace: true };

module.exports = [
  {
    ...readBase, name: 'git.status',
    description: 'Show the working tree status: current branch, ahead/behind counts, staged/unstaged/untracked files.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) {
      const res = await runGit(['status', '--porcelain=v1', '-b'], ctx);
      assertGitOk(res, 'status');
      return parseStatus(res.stdout);
    },
  },
  {
    ...readBase, name: 'git.diff',
    description: 'Show a diff of changes. staged=true shows what is staged for commit (git diff --cached); otherwise shows unstaged working-tree changes.',
    inputSchema: { type: 'object', properties: { staged: { type: 'boolean' }, path: { type: 'string', description: 'Limit the diff to one file/folder.' } } },
    async execute({ staged, path: p }, ctx) {
      const argv = ['diff', '--no-color', '--no-ext-diff', '--no-textconv'];
      if (staged) argv.push('--cached');
      if (p) argv.push('--', toWorkspaceRelPaths(ctx, [p])[0]);
      const res = await runGit(argv, ctx);
      assertGitOk(res, 'diff');
      return { diff: truncate(res.stdout, MAX_DIFF), staged: !!staged };
    },
  },
  {
    ...writeBase, name: 'git.add',
    description: 'Stage files for the next commit.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string' } } }, required: ['paths'] },
    async preview({ paths }) { return { title: 'git add', summary: paths.join('\n') }; },
    async execute({ paths }, ctx) {
      const rel = toWorkspaceRelPaths(ctx, paths);
      const res = await runGit(['add', '--', ...rel], ctx);
      assertGitOk(res, 'add');
      return { staged: rel };
    },
  },
  {
    ...writeBase, name: 'git.commit',
    description: 'Commit staged changes. Set add_all to stage every modified/deleted tracked file first (like "git commit -a") — new untracked files still need git.add.',
    inputSchema: { type: 'object', properties: { message: { type: 'string', maxLength: 2000 }, add_all: { type: 'boolean' } }, required: ['message'] },
    async preview({ message }, ctx) {
      const res = await runGit(['diff', '--cached', '--stat', '--no-ext-diff', '--no-textconv'], ctx);
      return { title: 'git commit', summary: `${message}\n\n${res.stdout || '(nothing staged yet — check add_all or git.add first)'}` };
    },
    async execute({ message, add_all }, ctx) {
      if (add_all) { const a = await runGit(['add', '-u'], ctx); assertGitOk(a, 'add -u'); }
                                                                                                
      const res = await runGit(['commit', '-m', message], ctx, undefined, { allowHooks: true });
      if (res.exit_code !== 0) {
        if (/nothing to commit/i.test(res.stdout)) return { committed: false, reason: 'Nothing staged to commit.' };
        assertGitOk(res, 'commit');
      }
      const hashRes = await runGit(['rev-parse', 'HEAD'], ctx);
      return { committed: true, hash: hashRes.stdout.trim(), message };
    },
  },
  {
    ...readBase, name: 'git.branch',
    description: 'List, create, switch to, or delete a branch.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['list', 'create', 'switch', 'delete'] }, name: { type: 'string', description: 'Required for create/switch/delete.' } },
      required: ['action'],
    },
    permission(args) { return args.action === 'list' ? LEVEL.READ : args.action === 'delete' ? LEVEL.SENSITIVE : LEVEL.WRITE; },
    async preview({ action, name }) { return action === 'list' ? undefined : { title: `git branch ${action}`, summary: name, category: 'git.write' }; },
    async execute({ action, name }, ctx) {
      if (action === 'list') {
        const res = await runGit(['branch', '--format=%(refname:short)%09%(HEAD)'], ctx);
        assertGitOk(res, 'branch');
        const branches = res.stdout.split('\n').filter(Boolean).map((l) => { const [n, head] = l.split('\t'); return { name: n, current: head === '*' }; });
        return { branches };
      }
      if (!name) throw new Error(`"name" is required for action "${action}".`);
      assertBranchName(name);
                                                                                                  
                                                    
      if (action === 'create') { const res = await runGit(['switch', '-c', name], ctx); assertGitOk(res, 'switch -c'); return { created: name, switched: true }; }
      if (action === 'switch') { const res = await runGit(['switch', name], ctx); assertGitOk(res, 'switch'); return { switched: name }; }
      if (action === 'delete') { const res = await runGit(['branch', '-d', '--', name], ctx); assertGitOk(res, 'branch -d'); return { deleted: name }; }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    ...readBase, name: 'git.log',
    description: 'Show recent commit history.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 }, path: { type: 'string' } } },
    async execute({ limit = 20, path: p }, ctx) {
      const argv = ['log', '--no-ext-diff', '--no-textconv', `-n${limit}`, '--date=iso', '--pretty=format:%H\x1f%an\x1f%ad\x1f%s'];
      if (p) argv.push('--', toWorkspaceRelPaths(ctx, [p])[0]);
      const res = await runGit(argv, ctx);
      if (res.exit_code !== 0 && /does not have any commits yet/i.test(res.stderr)) return { commits: [] };
      assertGitOk(res, 'log');
      return { commits: parseLog(res.stdout) };
    },
  },
  {
    ...readBase, name: 'git.remote_info',
    description: 'List configured git remotes (name, url).',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) {
      const res = await runGit(['remote', '-v'], ctx);
      assertGitOk(res, 'remote');
      const seen = new Map();
      for (const line of res.stdout.split('\n').filter(Boolean)) {
        const m = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
        if (m) seen.set(m[1] + m[3], { name: m[1], url: m[2], type: m[3] });
      }
      return { remotes: [...seen.values()] };
    },
  },
  {
    ...writeBase, name: 'git.init',
    description: 'Initialize a new git repository in the workspace root, if one does not exist yet.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) {
      const res = await runGit(['init'], ctx);
      assertGitOk(res, 'init');
      return { initialized: true };
    },
  },
];

module.exports.helpers = { assertBranchName, SAFE_GIT_CONFIG };
