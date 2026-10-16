'use strict';
   
                                                                         
                                                                         
                                                                       
                                                                           
                         
   
const { LEVEL } = require('../../permissions/levels');
const { runCommand } = require('../terminal/executor');
const { truncate } = require('../../utils/misc');

const API = 'https://api.github.com';

async function ghFetch(ctx, method, apiPath, body) {
  const token = ctx.secrets.get('github:token');
  if (!token) throw new Error('No GitHub token set. Add one in Settings → GitHub (a personal access token with "repo" scope, or "public_repo" for public repos only).');
  const res = await fetch(`${API}${apiPath}`, {
    method,
    signal: ctx.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'AkhtarAgent',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`GitHub API ${method} ${apiPath}: HTTP ${res.status} — ${json.message || truncate(text, 300)}`);
  return json;
}

                                                                                                                                             
function parseGithubRemote(url) {
  const m = String(url).trim().replace(/\/+$/, '').match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

                                                                                        
                                                          
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
function assertRepoRef(r) {
  for (const [k, v] of Object.entries({ owner: r.owner, repo: r.repo })) {
    if (!NAME_RE.test(String(v || '')) || v === '.' || v === '..') throw new Error(`Invalid GitHub ${k} "${v}".`);
  }
  return r;
}

async function detectRepo(ctx, owner, repo) {
  if (owner && repo) return assertRepoRef({ owner, repo });
  if (!ctx.workspace) throw new Error('No workspace open and no owner/repo given — pass them explicitly.');
  const res = await runCommand(['git', 'remote', 'get-url', 'origin'], { cwd: ctx.workspace.root_path, timeoutMs: 10000, signal: ctx.signal });
  if (res.exit_code !== 0) throw new Error('Could not read the "origin" git remote to detect owner/repo. Pass owner and repo explicitly.');
  const parsed = parseGithubRemote(res.stdout);
  if (!parsed) throw new Error(`Remote "origin" (${res.stdout.trim()}) doesn't look like a GitHub URL. Pass owner and repo explicitly.`);
  return assertRepoRef(parsed);
}

const readBase = { group: 'github', permission: LEVEL.NETWORK, category: 'network.github' };
const writeBase = { group: 'github', permission: LEVEL.SENSITIVE, category: 'github.write' };
const repoProps = { owner: { type: 'string', description: 'Defaults to the workspace\'s git origin remote.' }, repo: { type: 'string' } };

function summarizeIssue(i) {
  return { number: i.number, title: i.title, state: i.state, is_pr: !!i.pull_request, url: i.html_url, author: i.user?.login, created_at: i.created_at, comments: i.comments };
}
function summarizePr(p) {
  return { number: p.number, title: p.title, state: p.state, draft: p.draft, url: p.html_url, author: p.user?.login, base: p.base?.ref, head: p.head?.ref, mergeable: p.mergeable, created_at: p.created_at };
}

module.exports = [
  {
    ...readBase, name: 'github.repo_info',
    description: 'Get basic info about a GitHub repo (description, default branch, star count, open issue count).',
    inputSchema: { type: 'object', properties: { ...repoProps } },
    async execute({ owner, repo }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const j = await ghFetch(ctx, 'GET', `/repos/${r.owner}/${r.repo}`);
      return { owner: r.owner, repo: r.repo, description: j.description, default_branch: j.default_branch, stars: j.stargazers_count, open_issues: j.open_issues_count, private: j.private, url: j.html_url };
    },
  },
  {
    ...readBase, name: 'github.issue_list',
    description: 'List issues in a repo (pull requests are excluded unless include_prs is set — GitHub\'s API lists them together internally).',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, state: { type: 'string', enum: ['open', 'closed', 'all'] }, include_prs: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    async execute({ owner, repo, state = 'open', include_prs, limit = 30 }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const j = await ghFetch(ctx, 'GET', `/repos/${r.owner}/${r.repo}/issues?state=${state}&per_page=${limit}`);
      const list = Array.isArray(j) ? j : [];
      return { issues: (include_prs ? list : list.filter((i) => !i.pull_request)).map(summarizeIssue) };
    },
  },
  {
    ...writeBase, name: 'github.issue_create',
    description: 'Create a new issue.',
    inputSchema: { type: 'object', properties: { ...repoProps, title: { type: 'string', maxLength: 300 }, body: { type: 'string', maxLength: 60000 }, labels: { type: 'array', items: { type: 'string' } } }, required: ['title'] },
    async preview({ title, body }) { return { title: `Create GitHub issue "${title}"`, summary: truncate(body || '', 300) }; },
    async execute({ owner, repo, title, body, labels }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const j = await ghFetch(ctx, 'POST', `/repos/${r.owner}/${r.repo}/issues`, { title, body, labels });
      return summarizeIssue(j);
    },
  },
  {
    ...writeBase, name: 'github.issue_comment',
    description: 'Add a comment to an existing issue or PR (PRs are issues under the hood on GitHub).',
    inputSchema: { type: 'object', properties: { ...repoProps, issue_number: { type: 'integer' }, body: { type: 'string', maxLength: 60000 } }, required: ['issue_number', 'body'] },
    async preview({ issue_number, body }) { return { title: `Comment on #${issue_number}`, summary: truncate(body, 300) }; },
    async execute({ owner, repo, issue_number, body }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const j = await ghFetch(ctx, 'POST', `/repos/${r.owner}/${r.repo}/issues/${issue_number}/comments`, { body });
      return { id: j.id, url: j.html_url };
    },
  },
  {
    ...readBase, name: 'github.pr_list',
    description: 'List pull requests in a repo.',
    inputSchema: { type: 'object', properties: { ...repoProps, state: { type: 'string', enum: ['open', 'closed', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    async execute({ owner, repo, state = 'open', limit = 30 }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const j = await ghFetch(ctx, 'GET', `/repos/${r.owner}/${r.repo}/pulls?state=${state}&per_page=${limit}`);
      return { pull_requests: (Array.isArray(j) ? j : []).map(summarizePr) };
    },
  },
  {
    ...readBase, name: 'github.pr_view',
    description: 'Get details of one pull request, including files changed.',
    inputSchema: { type: 'object', properties: { ...repoProps, number: { type: 'integer' } }, required: ['number'] },
    async execute({ owner, repo, number }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const pr = await ghFetch(ctx, 'GET', `/repos/${r.owner}/${r.repo}/pulls/${number}`);
      const files = await ghFetch(ctx, 'GET', `/repos/${r.owner}/${r.repo}/pulls/${number}/files`);
      return { ...summarizePr(pr), body: pr.body, additions: pr.additions, deletions: pr.deletions, changed_files: (Array.isArray(files) ? files : []).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })) };
    },
  },
  {
    ...writeBase, name: 'github.pr_create',
    description: 'Create a pull request from an already-pushed branch (push it first with terminal.run "git push").',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, title: { type: 'string', maxLength: 300 }, body: { type: 'string', maxLength: 60000 }, head: { type: 'string', description: 'Branch with your changes, e.g. "feature/x" or "yourfork:feature/x".' }, base: { type: 'string', description: 'Branch to merge into, e.g. "main".' }, draft: { type: 'boolean' } },
      required: ['title', 'head', 'base'],
    },
    async preview({ title, head, base }) { return { title: `Open PR "${title}"`, summary: `${head} → ${base}` }; },
    async execute({ owner, repo, title, body, head, base, draft }, ctx) {
      const r = await detectRepo(ctx, owner, repo);
      const j = await ghFetch(ctx, 'POST', `/repos/${r.owner}/${r.repo}/pulls`, { title, body, head, base, draft: !!draft });
      return summarizePr(j);
    },
  },
];

module.exports.helpers = { parseGithubRemote, detectRepo, ghFetch, assertRepoRef };
