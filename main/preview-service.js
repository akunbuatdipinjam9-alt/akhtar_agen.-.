'use strict';
                                                                                
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveInWorkspace, relPath, SENSITIVE_FILE } = require('../tools/filesystem/pathguard');
const { readZipEntries } = require('../utils/zip-reader');
const { isBinary } = require('../utils/misc');

const MAX_FILE = 32 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;
const MEDIA_EXT = new Set(['.mp3','.wav','.ogg','.m4a','.aac','.flac','.mp4','.webm','.mov']);
const IMAGE_EXT = new Set(['.png','.jpg','.jpeg','.webp','.gif','.bmp','.svg','.ico']);
const TEXT_EXT = new Set(['.txt','.md','.markdown','.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.scss','.less','.html','.htm','.json','.jsonc','.xml','.yml','.yaml','.toml','.ini','.env','.py','.java','.kt','.kts','.c','.h','.cpp','.hpp','.cs','.go','.rs','.php','.rb','.sh','.bash','.zsh','.ps1','.sql','.csv','.log']);

const MIME = {
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.pdf':'application/pdf','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac',
  '.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime',
};
function xmlDecode(s='') { return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
function textRuns(xml, tag='(?:w:t|a:t|t)') {
  const out=[]; const re=new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/(?:w:t|a:t|t)>`,'g'); let m;
  while ((m=re.exec(xml))) out.push(xmlDecode(m[1].replace(/<[^>]+>/g,'')));
  return out;
}
function docxPreview(buf) {
  const z=readZipEntries(buf); const doc=z.get('word/document.xml'); if(!doc) throw new Error('DOCX document.xml not found.');
  const xml=doc.toString('utf8'); const paras=[]; const re=/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g; let m;
  while((m=re.exec(xml)) && paras.length<1200){ const t=textRuns(m[1],'w:t').join(''); if(t.trim()) paras.push(t); }
  return { kind:'document', blocks:paras.map((text)=>({type:'p',text})), summary:`${paras.length} paragraf terbaca` };
}
function pptxPreview(buf) {
  const z=readZipEntries(buf); const slides=[];
  const names=[...z.keys()].filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/(\d+)/)[1])-Number(b.match(/(\d+)/)[1]));
  for(const name of names.slice(0,250)){ const texts=textRuns(z.get(name).toString('utf8'),'a:t').filter(Boolean); slides.push({number:slides.length+1,title:texts[0]||`Slide ${slides.length+1}`,texts:texts.slice(1)}); }
  return {kind:'slides',slides,summary:`${slides.length} slide terbaca`};
}
function cellCol(ref='A1'){ let n=0; for(const c of (ref.match(/[A-Z]+/i)?.[0]||'')){n=n*26+(c.toUpperCase().charCodeAt(0)-64);} return Math.max(0,n-1); }
function xlsxPreview(buf) {
  const z=readZipEntries(buf); let shared=[];
  const ss=z.get('xl/sharedStrings.xml'); if(ss){ const xml=ss.toString('utf8'); const re=/<si\b[^>]*>([\s\S]*?)<\/si>/g; let m; while((m=re.exec(xml))&&shared.length<200000)shared.push(textRuns(m[1],'t').join('')); }
  const sheets=[]; const names=[...z.keys()].filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/(\d+)/)[1])-Number(b.match(/(\d+)/)[1]));
  for(const name of names.slice(0,50)){
    const xml=z.get(name).toString('utf8'); const rows=[]; const rr=/<row\b[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while((rm=rr.exec(xml))&&rows.length<300){ const row=[]; const cr=/<c\b([^>]*)>([\s\S]*?)<\/c>/g; let cm;
      while((cm=cr.exec(rm[1]))){ const attrs=cm[1],body=cm[2],ref=(attrs.match(/\br="([^"]+)"/)||[])[1]||''; const typ=(attrs.match(/\bt="([^"]+)"/)||[])[1]||''; let v=(body.match(/<v[^>]*>([\s\S]*?)<\/v>/)||[])[1] ?? (body.match(/<t[^>]*>([\s\S]*?)<\/t>/)||[])[1] ?? ''; if(typ==='s')v=shared[Number(v)]??v; row[cellCol(ref)]=xmlDecode(v); }
      rows.push(row.map(v=>v??'')); }
    sheets.push({name:`Sheet ${sheets.length+1}`,rows});
  }
  return {kind:'spreadsheet',sheets,summary:`${sheets.length} sheet terbaca`};
}
function glbInfo(buf){ if(buf.length<20||buf.toString('ascii',0,4)!=='glTF')return null; const jsonLen=buf.readUInt32LE(12),jsonType=buf.readUInt32LE(16); if(jsonType!==0x4e4f534a||20+jsonLen>buf.length)return null; try{return JSON.parse(buf.subarray(20,20+jsonLen).toString('utf8').replace(/\0+$/,''));}catch{return null;} }
function modelPreview(buf,ext){ let j=null; if(ext==='.gltf'){try{j=JSON.parse(buf.toString('utf8'));}catch{}} else j=glbInfo(buf); if(!j)return {kind:'binary',summary:'Model 3D terdeteksi, metadata tidak dapat dibaca.'}; return {kind:'model3d',summary:`${j.meshes?.length||0} mesh · ${j.materials?.length||0} material · ${j.nodes?.length||0} node`,model:{asset:j.asset||{},scenes:j.scenes?.length||0,nodes:j.nodes?.length||0,meshes:j.meshes?.length||0,materials:j.materials?.length||0,animations:j.animations?.length||0}}; }
function dataUrl(buf,mime){return `data:${mime};base64,${buf.toString('base64')}`;}

class PreviewService {
  constructor(app){this.app=app;this.active=null;}
  _send(event){const w=this.app.getWindow?.();if(w&&!w.isDestroyed())w.webContents.send('preview:event',event);}
  open(workspace,p,{emit=true}={}){
    if(!workspace?.root_path)throw new Error('Open a workspace first.');
    const abs=resolveInWorkspace(workspace.root_path,p,{allowRoot:false}); const st=fs.statSync(abs); if(!st.isFile())throw new Error('Preview path is not a file.'); if(st.size>MAX_FILE)throw new Error(`File terlalu besar untuk preview (${Math.round(st.size/1024/1024)} MB, batas 32 MB).`);
    const rel=relPath(workspace.root_path,abs); if(SENSITIVE_FILE.test(rel))throw new Error('Sensitive files are not shown in Universal Preview.');
    const buf=fs.readFileSync(abs), ext=path.extname(abs).toLowerCase(), name=path.basename(abs); let payload={id:crypto.randomUUID(),path:rel,name,size:st.size,ext,mtime:st.mtimeMs,kind:'binary',summary:'Preview metadata saja.'};
    if(ext==='.pdf') payload={...payload,kind:'pdf',dataUrl:dataUrl(buf,'application/pdf')};
    else if(IMAGE_EXT.has(ext)) payload={...payload,kind:'image',dataUrl:dataUrl(buf,MIME[ext]||'application/octet-stream')};
    else if(MEDIA_EXT.has(ext)) payload={...payload,kind:ext==='.mp3'||ext==='.wav'||ext==='.ogg'||ext==='.m4a'||ext==='.aac'||ext==='.flac'?'audio':'video',dataUrl:dataUrl(buf,MIME[ext]||'application/octet-stream')};
    else if(ext==='.docx') payload={...payload,...docxPreview(buf)};
    else if(ext==='.pptx') payload={...payload,...pptxPreview(buf)};
    else if(ext==='.xlsx') payload={...payload,...xlsxPreview(buf)};
    else if(ext==='.gltf'||ext==='.glb') payload={...payload,...modelPreview(buf,ext)};
    else if(TEXT_EXT.has(ext)||(!isBinary(buf.subarray(0,Math.min(buf.length,8192))))){ let text=buf.subarray(0,MAX_TEXT).toString('utf8'); if(ext==='.json'||ext==='.jsonc'){try{text=JSON.stringify(JSON.parse(text.replace(/^\s*\/\/.*$/gm,'')),null,2);}catch{}} payload={...payload,kind:ext==='.html'||ext==='.htm'?'html':ext==='.csv'?'csv':ext==='.md'||ext==='.markdown'?'markdown':'text',text,truncated:buf.length>MAX_TEXT}; }
    this.active={workspaceId:workspace.id,workspaceRoot:workspace.root_path,path:rel,payload}; if(emit)this._send({type:'open',preview:payload}); return payload;
  }
  refresh(workspace){ if(!this.active)throw new Error('No preview is open.'); if(workspace?.id!==this.active.workspaceId)throw new Error('Active preview belongs to another workspace.'); const payload=this.open(workspace,this.active.path,{emit:false}); this._send({type:'refresh',preview:payload}); return payload; }
  close(){const had=!!this.active;this.active=null;this._send({type:'close'});return {closed:had};}
  inspect(options={}){
    if(!this.active)return null;
    const p=this.active.payload;
    const maxChars=Math.max(1000,Math.min(30000,Number(options.max_chars)||12000));
    const base={id:p.id,path:p.path,name:p.name,size:p.size,kind:p.kind,ext:p.ext,summary:p.summary||null,truncated:!!p.truncated};
    if(['text','markdown','html','csv'].includes(p.kind)){
      base.content=String(p.text||'').slice(0,maxChars);
      base.content_truncated=String(p.text||'').length>maxChars||!!p.truncated;
    } else if(p.kind==='document'){
      const text=(p.blocks||[]).map(b=>b.text||'').filter(Boolean).join('\n');
      base.content=text.slice(0,maxChars); base.content_truncated=text.length>maxChars;
    } else if(p.kind==='slides'){
      const requested=Math.max(1,Math.floor(Number(options.slide)||1));
      const slide=p.slides?.[requested-1]||null;
      base.slide_count=p.slides?.length||0; base.selected_slide=slide?requested:null;
      if(slide) base.slide={number:slide.number,title:slide.title,texts:slide.texts};
      else base.available_slides=(p.slides||[]).slice(0,100).map(s=>({number:s.number,title:s.title}));
    } else if(p.kind==='spreadsheet'){
      const sheets=p.sheets||[];
      let idx=0;
      if(typeof options.sheet==='number')idx=Math.max(0,Math.min(sheets.length-1,Math.floor(options.sheet)));
      else if(typeof options.sheet==='string'){const found=sheets.findIndex(s=>String(s.name).toLowerCase()===options.sheet.toLowerCase());if(found>=0)idx=found;}
      const sheet=sheets[idx]||null; base.sheet_count=sheets.length; base.selected_sheet=sheet?.name||null;
      if(sheet)base.rows=(sheet.rows||[]).slice(0,80).map(r=>(r||[]).slice(0,30));
    } else if(p.kind==='model3d') base.model=p.model||null;
    return base;
  }
}
module.exports={PreviewService};
