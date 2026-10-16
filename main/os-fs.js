'use strict';
   
                                                                         
                                                                         
                                                                        
                                                                     
                                                                      
                                                                   
                                                 
  
                                                                
                                                                                    
                                                                        
                                            
  
                                                                       
                                                             
                                                            
                                                                   
                                                            
                                 
                                      
                                 
                                  
                                     
                                                                                                                                                              
                                                                             
   
const fs = require('fs');
const path = require('path');
const { ipcMain, shell } = require('electron');
const { resolveInWorkspace } = require('../tools/filesystem/pathguard');
const { logger } = require('../utils/logger');

function registerOsFsIpc(app) {
  const root = app.osFsRoot;
  const abs = (p, opts) => resolveInWorkspace(root, p, opts);

  const handle = (channel, fn) => ipcMain.handle(channel, async (evt, ...args) => {
                                                                               
                                                                      
    if (!app.browserTabs?.isPrivilegedSender?.(evt.sender)) throw new Error('akhtarFS is not available in this page.');
    try { return await fn(...args); }
    catch (e) {
      logger.error(`osfs ${channel} failed`, e);
      throw e;                                                                                           
    }
  });

  handle('osfs:getRoot', async () => root);

  handle('osfs:list', async (relPath) => {
    const dir = abs(relPath);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
      const full = path.join(dir, d.name);
      let size = 0;
      try { size = d.isFile() ? fs.statSync(full).size : 0; } catch { /* race: deleted between readdir and stat */ }
      return { name: d.name, type: d.isDirectory() ? 'folder' : 'file', size };
    });
  });

  handle('osfs:readFile', async (relPath) => {
    const p = abs(relPath);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return fs.readFileSync(p, 'utf8');
  });

  handle('osfs:writeFile', async (relPath, content) => {
    const p = abs(relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content ?? ''), 'utf8');
    return true;
  });

  handle('osfs:writeBinary', async (relPath, base64) => {
    const p = abs(relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(String(base64 || ''), 'base64'));
    return true;
  });

  handle('osfs:mkdir', async (relPath) => { fs.mkdirSync(abs(relPath), { recursive: true }); return true; });

  handle('osfs:delete', async (relPath) => {
    fs.rmSync(abs(relPath, { allowRoot: false }), { recursive: true, force: true });
    return true;
  });

  handle('osfs:exists', async (relPath) => { try { return fs.existsSync(abs(relPath)); } catch { return false; } });

                                                                                     
  handle('osfs:migrate', async (tree) => {
    try {
      const rootNode = tree && tree['/'];
      if (!rootNode || rootNode.type !== 'folder') return { error: 'Struktur data tidak dikenali.' };
      fs.mkdirSync(abs('files'), { recursive: true });
      const walk = (node, relBase) => {
        for (const [name, child] of Object.entries(node.children || {})) {
          const rel = relBase ? `${relBase}/${name}` : name;
          if (child?.type === 'folder') { fs.mkdirSync(abs(`files/${rel}`), { recursive: true }); walk(child, rel); }
          else if (child?.type === 'file') {
            const p = abs(`files/${rel}`);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, String(child.content ?? ''), 'utf8');
          }
        }
      };
      walk(rootNode, '');
      return true;
    } catch (e) {
      return { error: e.message };
    }
  });

  handle('osfs:openRootFolder', async () => { shell.openPath(root); return true; });
}

module.exports = { registerOsFsIpc };
