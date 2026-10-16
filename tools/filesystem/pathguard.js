'use strict';
   
                                                                      
                                                               
   
const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv', '.cache', '.turbo', '.idea', '.vs']);
const SENSITIVE_FILE = /(^|[\\/])(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa|id_ed25519|id_ecdsa|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|\.npmrc|\.pypirc|\.netrc)$/i;

function isInside(root, target) {
  const rel = path.relative(root, target);
                                                                                           
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function realRoot(root) {
  if (!root) throw new Error('No workspace folder is open.');
  return fs.realpathSync.native(root);
}

                                                                                            
function resolveInWorkspace(root, p, { allowRoot = true } = {}) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('Path is required.');
  if (p.includes('\0')) throw new Error('Invalid path.');
  const rootReal = realRoot(root);
  const abs = path.resolve(rootReal, p.trim());
  if (!isInside(rootReal, abs)) throw new Error(`Path "${p}" is outside the workspace. Only files inside ${rootReal} are accessible.`);
                                                                        
                                                                                      
                                                                                           
  const lexists = (x) => { try { fs.lstatSync(x); return true; } catch { return false; } };
  let probe = abs;
  while (!lexists(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  let probeReal;
  try { probeReal = fs.realpathSync.native(probe); }
  catch {
                                                                             
    const st = fs.lstatSync(probe);
    if (!st.isSymbolicLink()) throw new Error(`Cannot resolve path "${p}".`);
    const target = path.resolve(path.dirname(probe), fs.readlinkSync(probe));
    if (!isInside(rootReal, target)) throw new Error(`Path "${p}" resolves outside the workspace via a symlink.`);
    probeReal = probe;
  }
  if (!isInside(rootReal, probeReal)) throw new Error(`Path "${p}" resolves outside the workspace via a symlink.`);
  if (!allowRoot && path.relative(rootReal, abs) === '') throw new Error('This operation is not allowed on the workspace root.');
  return abs;
}

function relPath(root, abs) {
  const rel = path.relative(realRoot(root), abs) || '.';
  return rel.split(path.sep).join('/');
}

function isGitInternal(root, abs) {
  const rel = relPath(root, abs);
  return rel === '.git' || rel.startsWith('.git/');
}

module.exports = { resolveInWorkspace, relPath, isInside, isGitInternal, IGNORED_DIRS, SENSITIVE_FILE };
