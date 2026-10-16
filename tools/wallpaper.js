'use strict';
                                                                   
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { LEVEL } = require('../permissions/levels');
const { resolveInWorkspace, relPath } = require('./filesystem/pathguard');

const execFileAsync = promisify(execFile);
const SUPPORTED = new Set(['win32', 'darwin']);
let previousWallpaper = null;

function platform() { return process.platform; }
function assertSupported() {
  if (!SUPPORTED.has(platform())) throw new Error('Native wallpaper control is supported only on Windows and macOS.');
}
async function assertImage(file) {
  if (!/\.(?:png|jpe?g|bmp|webp|heic|tiff?)$/i.test(file)) throw new Error('Wallpaper must be an image file (png, jpg/jpeg, bmp, webp, heic, tif/tiff).');
  const st = await fs.stat(file);
  if (!st.isFile()) throw new Error('Wallpaper path is not a file.');
}
async function run(command, args) {
  return execFileAsync(command, args, { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
}
async function getCurrent() {
  assertSupported();
  if (platform() === 'win32') {
    const script = `(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallPaper).WallPaper`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return stdout.trim();
  }
  const { stdout } = await run('osascript', ['-e', 'tell application "System Events" to get picture of current desktop']);
  return stdout.trim();
}
async function setNative(file) {
  assertSupported();
  if (platform() === 'win32') {
                                                                                                                   
    const escaped = file.replace(/'/g, "''");
    const script = `$p='${escaped}'; Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class AkhtarWallpaper { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SystemParametersInfo(int a,int b,string c,int d); }\n'@; if(-not [AkhtarWallpaper]::SystemParametersInfo(20,0,$p,3)){ throw 'SystemParametersInfo failed' }`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  } else {
                                                                                         
    const script = 'on run argv\nset p to POSIX file (item 1 of argv)\ntell application "System Events" to repeat with d in desktops\nset picture of d to p\nend repeat\nend run';
    await run('osascript', ['-e', script, file]);
  }
}

module.exports = [
  {
    name: 'wallpaper.get', group: 'system', permission: LEVEL.READ, category: 'system.read',
    description: 'Read the current native desktop wallpaper path on Windows or macOS.',
    inputSchema: { type: 'object', properties: {} },
    async execute() { const current = await getCurrent(); return { platform: platform(), path: current, supported: true }; },
  },
  {
    name: 'wallpaper.set', group: 'system', permission: LEVEL.SENSITIVE, category: 'system.control', lifetimePermission: true, requiresWorkspace: true,
    description: 'Set the real OS desktop wallpaper on Windows or macOS from an image inside the approved workspace. Changes an OS setting and requires confirmation.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, description: 'Workspace-relative image path.' } }, required: ['path'] },
    async preview({ path: p }, ctx) { const abs = resolveInWorkspace(ctx.workspace.root_path, p); return { title: 'Change desktop wallpaper', summary: relPath(ctx.workspace.root_path, abs), warning: 'This changes the real operating-system wallpaper.' }; },
    async execute({ path: p }, ctx) {
      assertSupported();
      const abs = resolveInWorkspace(ctx.workspace.root_path, p);
      await assertImage(abs);
      const before = await getCurrent().catch(() => null);
      await setNative(abs);
      previousWallpaper = before;
      const after = await getCurrent().catch(() => abs);
      const confirmed = path.normalize(after) === path.normalize(abs);
      return { changed: true, platform: platform(), path: abs, previous: before, verified: confirmed, _beforeAfter: { ok:true, confirmed, signals:['native_readback'], reason: confirmed ? 'Wallpaper path read-back matches the requested image.' : 'Wallpaper command completed but read-back did not match.', checkedAt:Date.now(), before:{ path:before }, after:{ path:after } } };
    },
  },
  {
    name: 'wallpaper.restore', group: 'system', permission: LEVEL.SENSITIVE, category: 'system.control', lifetimePermission: true,
    description: 'Restore the wallpaper that was active immediately before the most recent wallpaper.set in this app session.',
    inputSchema: { type: 'object', properties: {} },
    async preview() { return { title: 'Restore previous wallpaper', summary: previousWallpaper || 'No previous wallpaper recorded in this session' }; },
    async execute() {
      assertSupported();
      if (!previousWallpaper) throw new Error('No previous wallpaper is recorded in this app session.');
      const target = previousWallpaper;
      await assertImage(target);
      await setNative(target);
      const after = await getCurrent().catch(() => target);
      const confirmed = path.normalize(after) === path.normalize(target);
      previousWallpaper = null;
      return { restored: true, platform: platform(), path: target, verified: confirmed, _beforeAfter: { ok:true, confirmed, signals:['native_readback'], reason: confirmed ? 'Wallpaper restore was confirmed by read-back.' : 'Wallpaper restore command completed but read-back did not match.', checkedAt:Date.now(), before:null, after:{ path:after } } };
    },
  },
];
