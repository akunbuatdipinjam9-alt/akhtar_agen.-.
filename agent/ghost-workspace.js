'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const IGNORE = new Set(['.git','node_modules','.next','dist','build','coverage','.cache']);
const GHOST_ROOT = path.join(os.tmpdir(),'akhtar-agent-ghost');
const DEFAULT_MAX_AGE_MS = 24*60*60*1000;                                                
function hash(p){ const h=crypto.createHash('sha256'); h.update(fs.readFileSync(p)); return h.digest('hex'); }
function walk(root, base=root, out=new Map()) { if(!fs.existsSync(root)) return out; for(const e of fs.readdirSync(root,{withFileTypes:true})){ if(IGNORE.has(e.name)) continue; const p=path.join(root,e.name); const rel=path.relative(base,p); if(e.isDirectory()) walk(p,base,out); else if(e.isFile()) out.set(rel,{size:fs.statSync(p).size,hash:hash(p)}); } return out; }
function copyTree(src,dst){ fs.mkdirSync(dst,{recursive:true}); for(const e of fs.readdirSync(src,{withFileTypes:true})){ if(IGNORE.has(e.name)) continue; const a=path.join(src,e.name), b=path.join(dst,e.name); if(e.isDirectory()) copyTree(a,b); else if(e.isFile()){ fs.mkdirSync(path.dirname(b),{recursive:true}); fs.copyFileSync(a,b); } } }
class GhostWorkspaceManager {
 constructor(){ this.sessions=new Map(); }
 create(workspace){ if(!workspace?.root_path) throw new Error('Open a workspace first.'); const id=crypto.randomUUID(); const root=path.join(GHOST_ROOT,id); copyTree(workspace.root_path,root); const s={id,sourceWorkspaceId:workspace.id,sourceRoot:workspace.root_path,rootPath:root,createdAt:Date.now(),baseline:walk(root)}; this.sessions.set(id,s); this._writeManifest(s); return this.public(s); }
                                                                              
                                                                                 
 _writeManifest(s){ try{ fs.writeFileSync(path.join(s.rootPath,'manifest.json'),JSON.stringify({id:s.id,sourceWorkspaceId:s.sourceWorkspaceId,sourceRoot:s.sourceRoot,createdAt:s.createdAt},null,2)); }catch{} }
 _adopt(manifest,rootPath){ const s={id:manifest.id,sourceWorkspaceId:manifest.sourceWorkspaceId,sourceRoot:manifest.sourceRoot,rootPath,createdAt:manifest.createdAt,baseline:walk(rootPath)}; this.sessions.set(s.id,s); return s; }
                                                                                   
 discoverSessions(maxAgeMs=DEFAULT_MAX_AGE_MS){ const found=[]; if(!fs.existsSync(GHOST_ROOT)) return found; const nowMs=Date.now();
  for(const e of fs.readdirSync(GHOST_ROOT,{withFileTypes:true})){ if(!e.isDirectory()) continue; const root=path.join(GHOST_ROOT,e.name);
   try{ const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')); if(!m.id||!m.sourceRoot) continue;
    if(nowMs-(m.createdAt||0)>maxAgeMs) continue;                                   
    if(this.sessions.has(m.id)) continue;
    found.push(this.public(this._adopt(m,root))); }catch{ /* no/invalid manifest — not a recoverable session */ } }
  return found; }
                                                                                  
 cleanupStale(maxAgeMs=DEFAULT_MAX_AGE_MS){ let removed=0; if(!fs.existsSync(GHOST_ROOT)) return {removed}; const nowMs=Date.now();
  for(const e of fs.readdirSync(GHOST_ROOT,{withFileTypes:true})){ if(!e.isDirectory()) continue; const root=path.join(GHOST_ROOT,e.name); let createdAt=0;
   try{ createdAt=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).createdAt||0; }catch{ try{ createdAt=fs.statSync(root).mtimeMs; }catch{} }
   if(nowMs-createdAt>maxAgeMs){ try{ fs.rmSync(root,{recursive:true,force:true}); this.sessions.delete(e.name); removed++; }catch{} } }
  return {removed}; }
 public(s){ const changes=this.diff(s.id); return {id:s.id,sourceWorkspaceId:s.sourceWorkspaceId,sourceRoot:s.sourceRoot,rootPath:s.rootPath,createdAt:s.createdAt,changes}; }
 get(id){ return this.sessions.get(id); }
 diff(id){ const s=this.get(id); if(!s) throw new Error('Ghost workspace not found.'); const cur=walk(s.rootPath), changes=[]; for(const [rel,m] of cur){ if(rel==='manifest.json') continue; const b=s.baseline.get(rel); if(!b) changes.push({path:rel,status:'added'}); else if(b.hash!==m.hash) changes.push({path:rel,status:'modified'}); } for(const rel of s.baseline.keys()) if(rel!=='manifest.json'&&!cur.has(rel)) changes.push({path:rel,status:'deleted'}); return changes; }
 apply(id,{force=false}={}){ const s=this.get(id); if(!s) throw new Error('Ghost workspace not found.'); const changes=this.diff(id);
                                                                                            
                                                                                            
  const conflicts=[]; for(const c of changes){ const dst=path.join(s.sourceRoot,c.path); const base=s.baseline.get(c.path); const exists=fs.existsSync(dst);
   if(c.status==='added'){ if(exists) conflicts.push({path:c.path,reason:'created in the real workspace too'}); }
   else if(!exists){ if(c.status==='modified') conflicts.push({path:c.path,reason:'deleted in the real workspace'}); }
   else if(hash(dst)!==base.hash) conflicts.push({path:c.path,reason:'changed in the real workspace since the ghost was created'}); }
  if(conflicts.length&&!force){ const e=new Error(`Ghost apply blocked: ${conflicts.length} file(s) changed in the real workspace meanwhile (${conflicts.slice(0,5).map(c=>c.path).join(', ')}${conflicts.length>5?', …':''}). Review, then apply with force to overwrite.`); e.conflicts=conflicts; throw e; }
  for(const c of changes){ const src=path.join(s.rootPath,c.path), dst=path.join(s.sourceRoot,c.path); if(c.status==='deleted'){ if(fs.existsSync(dst)) fs.rmSync(dst,{force:true}); } else { fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst); } }
  s.baseline=walk(s.rootPath);                                                                          
  return {applied:changes.length,changes,forced:!!(force&&conflicts.length),conflicts}; }
 discardAll(){ for(const id of [...this.sessions.keys()]){ try{ this.discard(id); }catch{} } }
 discard(id){ const s=this.get(id); if(!s) return {discarded:false}; fs.rmSync(s.rootPath,{recursive:true,force:true}); this.sessions.delete(id); return {discarded:true}; }
}
module.exports={GhostWorkspaceManager};
