'use strict';
   
                                                                          
                                                  
                                                                        
                                                                    
   
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { LEVEL } = require('../../permissions/levels');
const { resolveInWorkspace, relPath, isGitInternal, IGNORED_DIRS, SENSITIVE_FILE } = require('./pathguard');
const { unifiedDiff } = require('../../utils/diff');
const { isBinary, sha256 } = require('../../utils/misc');

const MAX_READ = 256 * 1024;
const MAX_EDIT_FILE = 2 * 1024 * 1024;
const MAX_SNAPSHOT_FOLDER_BYTES = 10 * 1024 * 1024;

const root = (ctx) => ctx.workspace.root_path;
const R = (ctx, p, opts) => resolveInWorkspace(root(ctx), p, opts);
const rel = (ctx, abs) => relPath(root(ctx), abs);

async function exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } }
async function readMaybe(p) { try { return await fsp.readFile(p); } catch { return null; } }

function assertWritable(ctx, abs) {
  if (isGitInternal(root(ctx), abs)) throw new Error('Writing inside .git is not allowed.');
}

async function readText(abs) {
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw new Error('Not a file.');
  if (st.size > MAX_EDIT_FILE) throw new Error(`File is too large to edit as text (${st.size} bytes).`);
  const buf = await fsp.readFile(abs);
  if (isBinary(buf)) throw new Error('File appears to be binary.');
  return buf.toString('utf8');
}

async function writeVerified(abs, content) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.akhtar-tmp-${process.pid}`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, abs);
  const back = await fsp.readFile(abs);
  const ok = sha256(back) === sha256(Buffer.from(content, 'utf8'));
  if (!ok) throw new Error('Verification failed: file content on disk does not match what was written.');
  return { verified: true, bytes: back.length };
}

const MAX_SNAPSHOT_FILE_BYTES = 20 * 1024 * 1024;

async function snapshotFile(ctx, abs, action = 'write') {
                                                                                       
                                                                                         
                                                                    
  let size = -1;
  try { size = (await fsp.stat(abs)).size; } catch { /* doesn't exist */ }
  if (size > MAX_SNAPSHOT_FILE_BYTES) {
    ctx.checkpoints.record(ctx, { action, path: abs, before: null, extra: { unrestorable: true, reason: `File was ${size} bytes — too large to snapshot.` } });
    return;
  }
  const before = size >= 0 ? await readMaybe(abs) : null;
  ctx.checkpoints.record(ctx, { action, path: abs, before });
}

async function* walk(dir, { maxEntries = 20000, ignore = true } = {}) {
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = await fsp.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++count > maxEntries) return;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!ignore || !IGNORED_DIRS.has(e.name)) stack.push(full);
        yield { full, dir: true, name: e.name };
      } else if (e.isFile()) {
        yield { full, dir: false, name: e.name };
      }
    }
  }
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`(^|/)${re}$`, 'i');
}

function normEol(s) { return s.replace(/\r\n/g, '\n'); }

                                                
async function previewWrite(ctx, p, newContent, title) {
  const abs = R(ctx, p, { allowRoot: false });
  assertWritable(ctx, abs);
  let old = '';
  let existed = false;
  if (await exists(abs)) { old = await readText(abs); existed = true; }
  const d = unifiedDiff(old, newContent, rel(ctx, abs));
  return {
    title: `${title}: ${rel(ctx, abs)}`,
    path: rel(ctx, abs),
    summary: existed ? `+${d.added} −${d.removed} lines` : `New file, ${newContent.split('\n').length} lines`,
    diff: d.diff,
  };
}

function computeEdit(content, oldStr, newStr, replaceAll) {
  const crlf = content.includes('\r\n');
  const norm = normEol(content);
  const o = normEol(oldStr);
  const n = normEol(newStr);
  if (!o) throw new Error('old_str must not be empty.');
  const count = norm.split(o).length - 1;
  if (count === 0) throw new Error('old_str was not found in the file. Read the file again and copy the exact text (including indentation).');
  if (count > 1 && !replaceAll) throw new Error(`old_str matches ${count} places. Add more surrounding context to make it unique, or set replace_all: true.`);
  const out = replaceAll ? norm.split(o).join(n) : norm.replace(o, () => n);
  return { result: crlf ? out.replace(/\n/g, '\r\n') : out, count: replaceAll ? count : 1 };
}

const P = (description, extra = {}) => ({ type: 'string', description, ...extra });
const fsTool = (def) => ({ group: 'filesystem', requiresWorkspace: true, ...def });

module.exports = [
  fsTool({
    name: 'file.read', category: 'filesystem.read',
    description: 'Read a text file in the workspace. Optionally a line range (1-based, inclusive). Output lines are prefixed with line numbers.',
    permission: (args) => (SENSITIVE_FILE.test(String(args.path || '')) ? LEVEL.SENSITIVE : LEVEL.READ),
    inputSchema: {
      type: 'object',
      properties: { path: P('Path relative to the workspace root.'), start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } },
      required: ['path'],
    },
    async preview({ path: p }, ctx) {
      if (SENSITIVE_FILE.test(p)) {
        return { title: `Read sensitive file: ${p}`, path: p, category: 'filesystem.read_sensitive', warning: 'This file may contain credentials. Its contents would be sent to the AI model.' };
      }
      return null;
    },
    async execute({ path: p, start_line, end_line }, ctx) {
      const abs = R(ctx, p);
      const st = await fsp.stat(abs);
      if (!st.isFile()) throw new Error(`"${p}" is not a file. Use folder.list for directories.`);
      const fd = await fsp.open(abs, 'r');
      let buf;
      try {
        buf = Buffer.alloc(Math.min(st.size, MAX_READ));
        await fd.read(buf, 0, buf.length, 0);
      } finally { await fd.close(); }
      if (isBinary(buf)) return { path: rel(ctx, abs), size: st.size, binary: true, note: 'Binary file; content not shown.' };
      const lines = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n');
      const s = Math.max(1, start_line || 1);
      const e = Math.min(lines.length, end_line || lines.length);
      const numbered = lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(5)}| ${l}`).join('\n');
      return {
        path: rel(ctx, abs), size: st.size, total_lines: lines.length, shown: `${s}-${e}`,
        truncated: st.size > MAX_READ, content: numbered,
      };
    },
  }),

  fsTool({
    name: 'file.create', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Create a new text file. Fails if the file already exists (use file.write or file.edit instead).',
    inputSchema: { type: 'object', properties: { path: P('Path relative to workspace root.'), content: P('Full file content.') }, required: ['path', 'content'] },
    async preview({ path: p, content }, ctx) {
      if (await exists(R(ctx, p))) throw new Error(`"${p}" already exists. Use file.edit or file.write.`);
      return previewWrite(ctx, p, content, 'Create file');
    },
    async execute({ path: p, content }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      if (await exists(abs)) throw new Error(`"${p}" already exists.`);
      await snapshotFile(ctx, abs);
      return { path: rel(ctx, abs), created: true, ...(await writeVerified(abs, content)) };
    },
  }),

  fsTool({
    name: 'file.write', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Write the full content of a file (creates or overwrites). Prefer file.edit for small changes to existing files.',
    inputSchema: { type: 'object', properties: { path: P('Path relative to workspace root.'), content: P('Full new file content.') }, required: ['path', 'content'] },
    async preview({ path: p, content }, ctx) { return previewWrite(ctx, p, content, 'Write file'); },
    async execute({ path: p, content }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      assertWritable(ctx, abs);
      await snapshotFile(ctx, abs);
      return { path: rel(ctx, abs), ...(await writeVerified(abs, content)) };
    },
  }),

  fsTool({
    name: 'file.edit', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Edit a file by replacing an exact, unique snippet (old_str) with new_str. Include enough context to be unique. Returns the diff.',
    inputSchema: {
      type: 'object',
      properties: { path: P('Path relative to workspace root.'), old_str: P('Exact existing text.'), new_str: P('Replacement text (may be empty).'), replace_all: { type: 'boolean' } },
      required: ['path', 'old_str', 'new_str'],
    },
    async preview({ path: p, old_str, new_str, replace_all }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      assertWritable(ctx, abs);
      const content = await readText(abs);
      const { result } = computeEdit(content, old_str, new_str, replace_all);
      return previewWrite(ctx, p, result, 'Edit file');
    },
    async execute({ path: p, old_str, new_str, replace_all }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      assertWritable(ctx, abs);
      const content = await readText(abs);
      const { result, count } = computeEdit(content, old_str, new_str, replace_all);
      await snapshotFile(ctx, abs);
      const w = await writeVerified(abs, result);
      const d = unifiedDiff(content, result, rel(ctx, abs));
      return { path: rel(ctx, abs), replacements: count, ...w, diff: d.diff };
    },
  }),

  fsTool({
    name: 'file.delete', permission: LEVEL.SENSITIVE, category: 'filesystem.delete',
    description: 'Delete a single file (a checkpoint is kept so it can be restored).',
    inputSchema: { type: 'object', properties: { path: P('File path.') }, required: ['path'] },
    async preview({ path: p }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      assertWritable(ctx, abs);
      const st = await fsp.stat(abs);
      if (!st.isFile()) throw new Error('Not a file. Use folder.delete for folders.');
      return { title: `Delete file: ${rel(ctx, abs)}`, path: rel(ctx, abs), summary: `${st.size} bytes — restorable from checkpoint` };
    },
    async execute({ path: p }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      await snapshotFile(ctx, abs, 'delete');
      await fsp.unlink(abs);
      return { path: rel(ctx, abs), deleted: true, verified: !(await exists(abs)) };
    },
  }),

  fsTool({
    name: 'file.copy', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Copy a file to a new path inside the workspace.',
    inputSchema: { type: 'object', properties: { from: P('Source file.'), to: P('Destination path.'), overwrite: { type: 'boolean' } }, required: ['from', 'to'] },
    async preview({ from, to }, ctx) { return { title: `Copy ${from} → ${to}`, path: to }; },
    async execute({ from, to, overwrite }, ctx) {
      const src = R(ctx, from);
      const dst = R(ctx, to, { allowRoot: false });
      assertWritable(ctx, dst);
      if (!overwrite && await exists(dst)) throw new Error(`"${to}" exists. Set overwrite: true to replace it.`);
      await snapshotFile(ctx, dst);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
      const ok = sha256(await fsp.readFile(src)) === sha256(await fsp.readFile(dst));
      return { from: rel(ctx, src), to: rel(ctx, dst), verified: ok };
    },
  }),

  ...['move', 'rename'].map((kind) => fsTool({
    name: `file.${kind}`, permission: LEVEL.WRITE, category: 'filesystem.write',
    description: kind === 'move' ? 'Move a file to another path in the workspace.' : 'Rename a file (same folder).',
    inputSchema: kind === 'move'
      ? { type: 'object', properties: { from: P('Source file.'), to: P('Destination path.') }, required: ['from', 'to'] }
      : { type: 'object', properties: { path: P('File path.'), new_name: P('New file name (no slashes).') }, required: ['path', 'new_name'] },
    async preview(args) {
      return kind === 'move' ? { title: `Move ${args.from} → ${args.to}`, path: args.from } : { title: `Rename ${args.path} → ${args.new_name}`, path: args.path };
    },
    async execute(args, ctx) {
      let src;
      let dst;
      if (kind === 'move') { src = R(ctx, args.from, { allowRoot: false }); dst = R(ctx, args.to, { allowRoot: false }); } else {
        if (/[\\/]/.test(args.new_name)) throw new Error('new_name must not contain slashes.');
        src = R(ctx, args.path, { allowRoot: false });
        dst = R(ctx, path.join(path.dirname(rel(ctx, src)), args.new_name), { allowRoot: false });
      }
      assertWritable(ctx, src); assertWritable(ctx, dst);
      if (await exists(dst)) throw new Error(`Destination "${rel(ctx, dst)}" already exists.`);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      ctx.checkpoints.record(ctx, { action: 'move', path: src, before: null, extra: { from: src, to: dst } });
      await fsp.rename(src, dst);
      return { from: rel(ctx, src), to: rel(ctx, dst), verified: (await exists(dst)) && !(await exists(src)) };
    },
  })),

  fsTool({
    name: 'file.info', permission: LEVEL.READ, category: 'filesystem.read',
    description: 'Get metadata for a file or folder (type, size, modified time).',
    inputSchema: { type: 'object', properties: { path: P('Path.') }, required: ['path'] },
    async execute({ path: p }, ctx) {
      const abs = R(ctx, p);
      const st = await fsp.stat(abs);
      return { path: rel(ctx, abs), type: st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other', size: st.size, modified: st.mtime.toISOString(), created: st.birthtime.toISOString() };
    },
  }),

  fsTool({
    name: 'file.search', permission: LEVEL.READ, category: 'filesystem.read',
    description: 'Find files by name or glob (e.g. "*.test.js", "src/**/preload*.js"). Ignores node_modules, .git, build output.',
    inputSchema: { type: 'object', properties: { pattern: P('Name fragment or glob.'), path: P('Folder to search (default root).'), max_results: { type: 'integer', minimum: 1, maximum: 500 } }, required: ['pattern'] },
    async execute({ pattern, path: p = '.', max_results = 100 }, ctx) {
      const base = R(ctx, p);
      const hasGlob = /[*?]/.test(pattern);
      const re = hasGlob ? globToRegex(pattern) : null;
      const needle = pattern.toLowerCase();
      const out = [];
      for await (const e of walk(base)) {
        if (e.dir) continue;
        const r = rel(ctx, e.full);
        if (hasGlob ? re.test(r) : e.name.toLowerCase().includes(needle)) out.push(r);
        if (out.length >= max_results) break;
      }
      return { matches: out, count: out.length, truncated: out.length >= max_results };
    },
  }),

  fsTool({
    name: 'file.search_text', permission: LEVEL.READ, category: 'filesystem.read',
    description: 'Search text inside workspace files (like grep). Returns file:line matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: P('Text or regular expression.'), regex: { type: 'boolean' }, case_sensitive: { type: 'boolean' },
        path: P('Folder to search (default root).'), include: P('Optional glob to filter files, e.g. "*.js".'),
        max_results: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['query'],
    },
    async execute({ query, regex, case_sensitive, path: p = '.', include, max_results = 100 }, ctx) {
      const base = R(ctx, p);
      let re;
      try { re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), case_sensitive ? '' : 'i'); } catch (e) { throw new Error(`Invalid regex: ${e.message}`); }
      const inc = include ? globToRegex(include) : null;
      const out = [];
      let filesScanned = 0;
      for await (const e of walk(base)) {
        if (e.dir) continue;
        const r = rel(ctx, e.full);
        if (inc && !inc.test(r)) continue;
        if (SENSITIVE_FILE.test(r)) continue;
        let st;
        try { st = await fsp.stat(e.full); } catch { continue; }
        if (st.size > 1024 * 1024) continue;
        const buf = await readMaybe(e.full);
        if (!buf || isBinary(buf)) continue;
        filesScanned++;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            out.push({ file: r, line: i + 1, text: lines[i].trim().slice(0, 240) });
            if (out.length >= max_results) break;
          }
        }
        if (out.length >= max_results) break;
      }
      return { matches: out, count: out.length, files_scanned: filesScanned, truncated: out.length >= max_results, note: 'Sensitive files (.env, keys) are skipped.' };
    },
  }),

  fsTool({
    name: 'folder.list', permission: LEVEL.READ, category: 'filesystem.read',
    description: 'List a folder\'s contents (optionally recursive up to depth 4). Ignores node_modules/.git.',
    inputSchema: { type: 'object', properties: { path: P('Folder (default ".").'), depth: { type: 'integer', minimum: 1, maximum: 4 } } },
    async execute({ path: p = '.', depth = 1 }, ctx) {
      const base = R(ctx, p);
      const out = [];
      const LIMIT = 600;
      async function rec(dir, level) {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { throw new Error(`Cannot list "${rel(ctx, dir)}": ${e.code || e.message}`); }
        entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
        for (const e of entries) {
          if (out.length >= LIMIT) return;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            const skipped = IGNORED_DIRS.has(e.name);
            out.push({ path: rel(ctx, full) + '/', type: 'dir', ...(skipped ? { note: 'not expanded' } : {}) });
            if (!skipped && level < depth) await rec(full, level + 1);
          } else {
            let size = null;
            try { size = (await fsp.stat(full)).size; } catch { /* ignore */ }
            out.push({ path: rel(ctx, full), type: 'file', size });
          }
        }
      }
      await rec(base, 1);
      return { root: rel(ctx, base), entries: out, truncated: out.length >= LIMIT };
    },
  }),

  fsTool({
    name: 'folder.create', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Create a folder (and parents).',
    inputSchema: { type: 'object', properties: { path: P('Folder path.') }, required: ['path'] },
    async preview({ path: p }) { return { title: `Create folder: ${p}`, path: p }; },
    async execute({ path: p }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      assertWritable(ctx, abs);
      if (await exists(abs)) return { path: rel(ctx, abs), created: false, note: 'Already exists.' };
                                                                                       
      let top = abs;
      while (!(await exists(path.dirname(top)))) top = path.dirname(top);
      ctx.checkpoints.record(ctx, { action: 'mkdir', path: top, before: null });
      await fsp.mkdir(abs, { recursive: true });
      return { path: rel(ctx, abs), created: true, verified: await exists(abs) };
    },
  }),

  fsTool({
    name: 'folder.copy', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Copy a folder recursively to a new location (destination must not exist).',
    inputSchema: { type: 'object', properties: { from: P('Source folder.'), to: P('Destination folder.') }, required: ['from', 'to'] },
    async preview({ from, to }) { return { title: `Copy folder ${from} → ${to}`, path: to }; },
    async execute({ from, to }, ctx) {
      const src = R(ctx, from, { allowRoot: false });
      const dst = R(ctx, to, { allowRoot: false });
      assertWritable(ctx, dst);
      if (await exists(dst)) throw new Error(`"${to}" already exists.`);
      if (dst.startsWith(src + path.sep)) throw new Error('Cannot copy a folder into itself.');
      ctx.checkpoints.record(ctx, { action: 'copy_dir', path: dst, before: null, extra: { dest: dst } });
      await fsp.cp(src, dst, { recursive: true, errorOnExist: true, force: false });
      return { from: rel(ctx, src), to: rel(ctx, dst), verified: await exists(dst) };
    },
  }),

  fsTool({
    name: 'folder.move', permission: LEVEL.WRITE, category: 'filesystem.write',
    description: 'Move or rename a folder inside the workspace.',
    inputSchema: { type: 'object', properties: { from: P('Source folder.'), to: P('Destination.') }, required: ['from', 'to'] },
    async preview({ from, to }) { return { title: `Move folder ${from} → ${to}`, path: from }; },
    async execute({ from, to }, ctx) {
      const src = R(ctx, from, { allowRoot: false });
      const dst = R(ctx, to, { allowRoot: false });
      assertWritable(ctx, src); assertWritable(ctx, dst);
      if (await exists(dst)) throw new Error(`"${to}" already exists.`);
      if (dst.startsWith(src + path.sep)) throw new Error('Cannot move a folder into itself.');
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      ctx.checkpoints.record(ctx, { action: 'move', path: src, before: null, extra: { from: src, to: dst } });
      await fsp.rename(src, dst);
      return { from: rel(ctx, src), to: rel(ctx, dst), verified: (await exists(dst)) && !(await exists(src)) };
    },
  }),

  fsTool({
    name: 'folder.delete', permission: LEVEL.CRITICAL, category: 'filesystem.delete_folder',
    description: 'Delete a folder and everything in it. Always requires explicit user confirmation.',
    inputSchema: { type: 'object', properties: { path: P('Folder path.') }, required: ['path'] },
    async preview({ path: p }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      assertWritable(ctx, abs);
      let files = 0;
      let bytes = 0;
      for await (const e of walk(abs, { maxEntries: 50000, ignore: false })) {
        if (!e.dir) { files++; try { bytes += (await fsp.stat(e.full)).size; } catch { /* ignore */ } }
      }
      const restorable = bytes <= MAX_SNAPSHOT_FOLDER_BYTES;
      return {
        title: `Delete folder: ${rel(ctx, abs)}`, path: rel(ctx, abs),
        summary: `${files} file(s), ${(bytes / 1024).toFixed(1)} KB`,
        warning: restorable ? 'Deletes every file inside. A checkpoint snapshot is kept.' : 'Folder is too large to snapshot — this CANNOT be undone.',
      };
    },
    async execute({ path: p }, ctx) {
      const abs = R(ctx, p, { allowRoot: false });
      let bytes = 0;
      const files = [];
      for await (const e of walk(abs, { maxEntries: 50000, ignore: false })) {
        if (!e.dir) { files.push(e.full); try { bytes += (await fsp.stat(e.full)).size; } catch { /* ignore */ } }
      }
      const restorable = bytes <= MAX_SNAPSHOT_FOLDER_BYTES;
      if (restorable) for (const f of files) await snapshotFile(ctx, f, 'delete');
      await fsp.rm(abs, { recursive: true, force: false });
      return { path: rel(ctx, abs), deleted: true, files_removed: files.length, restorable, verified: !(await exists(abs)) };
    },
  }),
];

module.exports.helpers = { computeEdit, globToRegex, walk };
