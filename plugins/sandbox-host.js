'use strict';
   
                                                                                
                                                                           
  
                           
                         
                                                                            
                                                              
                                                 
                                          
  
                                                                               
                                                               
   
const path = require('node:path');

const pluginMain = process.argv[2];
if (!pluginMain) throw new Error('Missing plugin main path.');

                                                                            
try { process.kill = () => { throw new Error('Plugin sandbox: process.kill is blocked.'); }; } catch {}
try { process.chdir = () => { throw new Error('Plugin sandbox: process.chdir is blocked.'); }; } catch {}
try { process.umask = () => { throw new Error('Plugin sandbox: process.umask is blocked.'); }; } catch {}

let tools;
try {
  const exported = require(path.resolve(pluginMain));
  tools = Array.isArray(exported) ? exported : (typeof exported === 'function' ? exported() : null);
  if (!Array.isArray(tools)) throw new Error('Plugin must export an array of tools, or a function returning one.');
} catch (e) {
  if (process.send) process.send({ type: 'fatal', error: e?.message || String(e) });
  process.exit(1);
}

const byName = new Map();
const descriptors = [];
for (const t of tools) {
  if (!t || typeof t !== 'object' || typeof t.name !== 'string' || typeof t.execute !== 'function') continue;
                                                                                     
                                                                                          
  if (typeof t.permission === 'function') throw new Error(`Plugin tool ${t.name}: dynamic permission functions are not allowed.`);
  byName.set(t.name, t);
  descriptors.push({
    name: t.name,
    group: t.group,
    description: t.description,
    inputSchema: t.inputSchema,
    permission: t.permission,
    category: t.category,
    retryable: t.retryable === true,
    timeoutMs: Number.isFinite(t.timeoutMs) ? t.timeoutMs : undefined,
  });
}

process.send?.({ type: 'ready', tools: descriptors });

process.on('message', async (m) => {
  if (!m || m.type !== 'execute') return;
  const tool = byName.get(m.name);
  if (!tool) return process.send?.({ type: 'result', id: m.id, ok: false, error: 'Unknown plugin tool.' });
  try {
    const secretMap = Object.freeze({ ...(m.secrets || {}) });
    const ctx = Object.freeze({
                                                                                 
                                                                           
      signal: undefined,
      secrets: Object.freeze({ get: (key) => Object.prototype.hasOwnProperty.call(secretMap, key) ? secretMap[key] : undefined }),
    });
    const value = await tool.execute(m.args || {}, ctx);
    process.send?.({ type: 'result', id: m.id, ok: true, value });
  } catch (e) {
    process.send?.({ type: 'result', id: m.id, ok: false, error: e?.message || String(e) });
  }
});
