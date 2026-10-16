'use strict';
                                                                                            
const fs = require('fs');
const { LEVEL } = require('../../permissions/levels');
const { classify, progName } = require('./classifier');
const { runCommand } = require('./executor');
const { resolveInWorkspace, relPath } = require('../filesystem/pathguard');


   
                                                                                 
                                                                                     
                                                                   
   
const GIT_SAFE_FLAGS = ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'protocol.ext.allow=never'];
function hardenGitArgv(argv, level) {
  if (!argv?.length || progName(argv[0]) !== 'git') return argv;
  const out = [argv[0], ...GIT_SAFE_FLAGS, ...argv.slice(1)];
  if (level === 'SAFE') {
    const i = out.findIndex((a, k) => k > GIT_SAFE_FLAGS.length && !a.startsWith('-'));
    const sub = i > 0 ? out[i].toLowerCase() : '';
    const extra = ['diff', 'log', 'show'].includes(sub) ? ['--no-textconv', '--no-ext-diff'] : sub === 'blame' ? ['--no-textconv'] : [];
    if (extra.length) out.splice(i + 1, 0, ...extra);
  }
  return out;
}

const MAP = { SAFE: LEVEL.READ, CAUTION: LEVEL.SENSITIVE, DANGEROUS: LEVEL.CRITICAL, BLOCKED: LEVEL.BLOCKED };
const CATEGORY = { SAFE: 'terminal.safe', CAUTION: 'terminal.caution', DANGEROUS: 'terminal.dangerous', BLOCKED: 'terminal.blocked' };

function prepare(args, ctx) {
  const root = ctx.workspace.root_path;
  const cwd = resolveInWorkspace(root, args.cwd || '.');
  if (!fs.statSync(cwd).isDirectory()) throw new Error('cwd must be a folder.');
  const c = classify(args.command, { cwd, root: fs.realpathSync.native(root) });
  return { cwd, c };
}

module.exports = [
  {
    name: 'terminal.run', group: 'terminal', requiresWorkspace: true, category: 'terminal',
    description:
      'Run ONE command in the workspace without a shell (no pipes, redirects, && or ;). ' +
      'Examples: "git status", "npm test", "npm run build", "node script.js". ' +
      'Long-running servers (npm run dev) are killed at timeout. Returns exit code and output tails.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line.' },
        cwd: { type: 'string', description: 'Working folder relative to workspace root (default ".").' },
        timeout_sec: { type: 'integer', minimum: 5, maximum: 900, description: 'Default from settings (120s).' },
      },
      required: ['command'],
    },
    permission: LEVEL.SENSITIVE, // refined per command in preview()
    timeoutMs: (args, ctx) => ((args.timeout_sec || ctx.settings.agent.toolTimeoutSec) * 1000) + 5000,
    async preview(args, ctx) {
      const { cwd, c } = prepare(args, ctx);
      return {
        title: `Run command (${c.level})`,
        command: args.command,
        path: relPath(ctx.workspace.root_path, cwd),
        summary: c.reason,
        level: MAP[c.level],
        category: CATEGORY[c.level],
        warning: c.level === 'DANGEROUS' ? `Potentially destructive: ${c.reason}` : c.level === 'BLOCKED' ? c.reason : undefined,
        classification: c.level,
      };
    },
    async execute(args, ctx) {
      const { cwd, c } = prepare(args, ctx);
      if (c.level === 'BLOCKED') throw new Error(`Blocked: ${c.reason}`);
      const timeoutMs = (args.timeout_sec || ctx.settings.agent.toolTimeoutSec) * 1000;
      const res = await runCommand(hardenGitArgv(c.argv, c.level), { cwd, timeoutMs, signal: ctx.signal, onOutput: ctx.onOutput });
      return {
        command: args.command, cwd: relPath(ctx.workspace.root_path, cwd), classification: c.level,
        ...res,
        success: res.exit_code === 0 && !res.timed_out && !res.cancelled,
      };
    },
  },
];

module.exports.hardenGitArgv = hardenGitArgv;
