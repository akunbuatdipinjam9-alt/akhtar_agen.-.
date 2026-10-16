'use strict';
   
                       
  
                                                                            
                                                                          
                                                                            
   
const path = require('path');

const MUTATING = /(?:\.write|\.create|\.edit|\.delete|\.remove|\.run|\.call|\.click|\.type|\.keypress|\.upload|\.commit|\.push|\.checkout|\.navigate|\.reload)$/;
const GLOBAL_SERIAL_GROUPS = new Set(['computer', 'git', 'github', 'mcp']);

function groupOf(name) { return String(name || '').split('.')[0]; }
function cleanPath(v) {
  if (!v || typeof v !== 'string') return '';
  try { return path.resolve(v).toLowerCase(); } catch { return String(v).toLowerCase(); }
}

function resourceKeys(call) {
  const name = String(call?.name || '');
  const args = call?.arguments || {};
  const group = groupOf(name);
  const keys = [];
  const p = cleanPath(args.path || args.file || args.file_path || args.destination || args.destination_path);
  if (p) keys.push(`path:${p}`);
  if (group === 'browser') keys.push(`browser:${args.tabId || args.tab_id || 'active'}`);
  if (group === 'terminal') keys.push(`terminal:${args.cwd ? cleanPath(args.cwd) : 'workspace'}`);
  if (GLOBAL_SERIAL_GROUPS.has(group)) keys.push(`group:${group}`);
  return keys;
}

function isMutation(call) { return MUTATING.test(String(call?.name || '')); }

function conflicts(a, b) {
  const ak = new Set(resourceKeys(a));
  const bk = resourceKeys(b);
  const shared = bk.some((k) => ak.has(k));
  if (!shared) return false;
                                                                            
                                                                              
  const sharedStateful = bk.some((k) => ak.has(k) && !k.startsWith('path:'));
  return sharedStateful || isMutation(a) || isMutation(b);
}

function buildWaves(calls, { maxConcurrency = 3 } = {}) {
  const limit = Math.max(1, Math.min(8, Number(maxConcurrency) || 3));
  const pending = calls.map((call, index) => ({ call, index }));
  const waves = [];
  while (pending.length) {
    const wave = [];
    for (let i = 0; i < pending.length && wave.length < limit;) {
      const candidate = pending[i];
      if (wave.every((x) => !conflicts(x.call, candidate.call))) {
        wave.push(candidate); pending.splice(i, 1);
      } else i++;
    }
                                                        
    if (!wave.length) wave.push(pending.shift());
    waves.push(wave);
  }
  return waves;
}

async function runParallelToolCalls(calls, { maxConcurrency = 3, execute, onWave } = {}) {
  if (typeof execute !== 'function') throw new Error('Parallel engine requires execute(call, index).');
  const waves = buildWaves(calls, { maxConcurrency });
  const results = new Array(calls.length);
  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi];
    onWave?.({ wave: wi + 1, totalWaves: waves.length, calls: wave.map(x => x.call) });
    const settled = await Promise.all(wave.map(async ({ call, index }) => {
      try { return { index, ok: true, value: await execute(call, index) }; }
      catch (error) { return { index, ok: false, error }; }
    }));
    for (const r of settled) results[r.index] = r;
  }
  return { waves, results };
}

module.exports = { resourceKeys, isMutation, conflicts, buildWaves, runParallelToolCalls };
