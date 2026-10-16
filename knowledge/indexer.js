'use strict';
                                                                                        
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SENSITIVE_FILE } = require('../tools/filesystem/pathguard');
const { redact } = require('../utils/logger');

const IGNORE_DIRS = new Set(['node_modules','.git','release','dist','build','.next','coverage','.cache','vendor']);
const TEXT_EXT = new Set(['.js','.cjs','.mjs','.ts','.tsx','.jsx','.json','.md','.txt','.html','.css','.scss','.py','.java','.kt','.go','.rs','.c','.cc','.cpp','.h','.hpp','.cs','.xml','.yml','.yaml','.toml','.ini','.sql','.gd','.sh','.ps1']);
const MAX_FILE = 512 * 1024;
const MAX_FILES = 2500;
                                                                                            
                                                                                     
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const CHUNK = 4200;
const OVERLAP = 500;

function tokens(s) { return String(s||'').toLowerCase().match(/[a-z0-9_.$-]{2,}/g) || []; }
function walk(root, out=[]) {
  if (out.length >= MAX_FILES) return out;
  let ents=[]; try { ents=fs.readdirSync(root,{withFileTypes:true}); } catch { return out; }
  for (const e of ents) {
    if (out.length >= MAX_FILES) break;
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    const p=path.join(root,e.name);
                                                                                              
                                                                            
    if (e.isFile() && SENSITIVE_FILE.test(p)) continue;
    if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(p,out); continue; }
    if (!e.isFile() || !TEXT_EXT.has(path.extname(e.name).toLowerCase())) continue;
    try { const st=fs.statSync(p); if (st.size <= MAX_FILE) out.push({path:p,size:st.size,mtimeMs:st.mtimeMs}); } catch {}
  }
  return out;
}
function chunks(text) {
  const out=[]; for(let i=0;i<text.length;i+=CHUNK-OVERLAP) out.push(text.slice(i,i+CHUNK)); return out;
}
class ProjectKnowledge {
  constructor(db){ this.db=db; this.cache=new Map(); }
  _fingerprint(files){ return crypto.createHash('sha1').update(files.map(f=>`${f.path}:${f.size}:${Math.floor(f.mtimeMs)}`).join('|')).digest('hex'); }
  index(workspace,{force=false}={}) {
    if (!workspace?.root_path) return {indexed:false,reason:'No workspace root'};
    const files=walk(workspace.root_path); const fp=this._fingerprint(files); const prev=this.cache.get(workspace.id);
    if (!force && prev?.fingerprint===fp) return {indexed:false,cached:true,files:prev.files.length,chunks:prev.chunks.length};
    const docs=[];
    const prevByPath=new Map(); for(const d of prev?.chunks||[]){ if(!prevByPath.has(d.abs)) prevByPath.set(d.abs,[]); prevByPath.get(d.abs).push(d); }
    const prevMeta=new Map((prev?.files||[]).map(f=>[f.path,f]));
    let total=0; const kept=[];
    for(const f of files){
      if(total+f.size>MAX_TOTAL_BYTES) continue; total+=f.size; kept.push(f);
                                                                                                   
      const pm=prevMeta.get(f.path);
      if(pm && pm.size===f.size && Math.floor(pm.mtimeMs)===Math.floor(f.mtimeMs) && prevByPath.has(f.path)){ docs.push(...prevByPath.get(f.path)); continue; }
      let text=''; try{text=fs.readFileSync(f.path,'utf8');}catch{continue;} if(text.includes('\u0000'))continue;
      text=redact(text);                                                             
      const rel=path.relative(workspace.root_path,f.path).replace(/\\/g,'/');
      chunks(text).forEach((content,i)=>docs.push({abs:f.path,path:rel,index:i,content,terms:new Set(tokens(rel+' '+content))}));
    }
    const data={fingerprint:fp,files:kept,chunks:docs,indexedAt:Date.now()}; this.cache.set(workspace.id,data);
    this.db.run('INSERT OR REPLACE INTO projects (id, workspace_id, root_path, index_json, indexed_at) VALUES (?,?,?,?,?)',
      [workspace.id,workspace.id,workspace.root_path,JSON.stringify({fingerprint:fp,fileCount:kept.length,chunkCount:docs.length,skippedForBudget:files.length-kept.length}),data.indexedAt]);
    return {indexed:true,files:kept.length,chunks:docs.length,skippedForBudget:files.length-kept.length,indexedAt:data.indexedAt};
  }
  search(workspace,query,{limit=6}={}) {
    if(!workspace?.root_path || !String(query||'').trim()) return [];
    this.index(workspace); const data=this.cache.get(workspace.id); if(!data)return [];
    const q=[...new Set(tokens(query))]; if(!q.length)return [];
    return data.chunks.map(d=>{ let score=0; for(const t of q){ if(d.terms.has(t))score+=3; if(d.path.toLowerCase().includes(t))score+=4; } return {d,score}; })
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(({d,score})=>({path:d.path,chunk:d.index,score,content:d.content}));
  }
}
module.exports={ProjectKnowledge,tokens};
