'use strict';
   
                           
  
                                                                              
                                                                         
                                                                            
                                                 
   

const FOUNDATION_GROUPS = new Set(['todo', 'skill']);
const GROUP_KEYWORDS = {
  filesystem: ['file','folder','directory','source','code','repo','project','edit','write','read','rename','delete','berkas','folder','kode','projek'],
  terminal: ['terminal','command','shell','npm','node','build','test','lint','install','run','compile','debug','error','cli'],
  code: ['obfuscate','obfuscation','javascript-obfuscator','protect source','acak kode','samarkan kode'],
  browser: ['browser','website','web','page','site','search online','internet','url','login','form','download','cari','carikan','riset','pencarian','harga','terbaru','smartphone','ponsel','hp gaming'],
  travel: ['travel','trip','road trip','itinerary','perjalanan','wisata','kuliner','oleh-oleh','souvenir','liburan','rute perjalanan'],
  lab: ['lab','laboratory','virtual lab','science experiment','experiment','chemistry','physics','simulasi','eksperimen','kimia','fisika','zat','campur','ramuan','bandul','pegas','parabola'],
  preview: ['preview','open file','show file','lihat file','buka file','tampilkan file','pratinjau','pdf','docx','pptx','xlsx','csv','markdown'],
  weather: ['weather','forecast','temperature','rain','cuaca','hujan','suhu'],
  time: ['time','timezone','date','jam','waktu','tanggal'],
  prayer: ['prayer','shalat','salat','adzan','azan','imsak'],
  hadith: ['hadith','hadis','riwayat','sanad'],
  moon: ['moon','lunar','hilal','hijri','bulan','qamariyah'],
  qibla: ['qibla','kiblat'],
  memory: ['remember','memory','recall','ingat','memori'],
  documents: ['document','docx','pdf','report','laporan','dokumen'],
  presentations: ['presentation','ppt','pptx','slide','presentasi'],
  map: ['map','location','route','peta','lokasi','rute'],
  image: ['image','picture','photo','generate image','gambar','foto'],
  chart: ['chart','graph','plot','visualization','grafik','diagram'],
  computer: ['computer','desktop','window','app','screen','keyboard','mouse','komputer','layar'],
  schedule: ['schedule','remind','later','daily','weekly','monthly','jadwal','ingatkan'],
  git: ['git','commit','branch','diff','merge','worktree'],
  github: ['github','pull request','issue','repository','repo remote'],
  mcp: ['mcp','server tool','external tool'],
  ai: ['delegate','second ai','reviewer','specialist','ai kedua','parallel worker','parallel','worker','subtask','subtugas'],
};

const READISH = /(?:\.read|\.list|\.get|\.search|\.find|\.observe|\.status|\.current|\.tabs|\.collections)$/;
const WRITEISH = /(?:\.write|\.create|\.edit|\.delete|\.remove|\.run|\.call|\.click|\.type|\.keypress|\.upload|\.commit|\.push|\.checkout)$/;

function words(s) { return String(s || '').toLowerCase(); }

function deriveMetadata(tool) {
  const group = tool.group || String(tool.name).split('.')[0];
  const readOnly = READISH.test(tool.name) && !WRITEISH.test(tool.name);
  const risk = String(typeof tool.permission === 'string' ? tool.permission : (tool.category || group)).toUpperCase();
  const capabilities = [group, ...(GROUP_KEYWORDS[group] || []).slice(0, 3)];
  const verification = [];
  if (group === 'filesystem' && /\.(write|create|edit)$/.test(tool.name)) verification.push('file.read');
  if (group === 'terminal' && tool.name === 'terminal.run') verification.push('check exit_code/stdout/stderr');
  if (group === 'browser' && /\.(click|type|keypress|navigate|fill_form|select_option|check|upload_file|back|forward|reload)$/.test(tool.name)) verification.push('browser.observe', 'browser.get_text', 'browser.get_page_state');
  if (group === 'git' && !readOnly) verification.push('git.status', 'git.diff');
  return { capabilities, risk, sideEffects: readOnly ? false : undefined, verification };
}

function annotateTools(tools) {
  return tools.map((tool) => ({ ...tool, toolIntelligence: { ...deriveMetadata(tool), ...(tool.toolIntelligence || {}) } }));
}

function inferGroups(text, mode) {
  const t = words(text);
  const groups = new Set(FOUNDATION_GROUPS);
  for (const [group, keywords] of Object.entries(GROUP_KEYWORDS)) {
    if (keywords.some((k) => t.includes(k))) groups.add(group);
  }
                                                                                        
  if (/(code|coding|implement|refactor|debug|fix|project|repo|kode|projek|benerin|perbaiki)/.test(t)) {
    groups.add('filesystem'); groups.add('terminal'); groups.add('git'); groups.add('code');
  }
  if (/(research|riset|audit|review|analy[sz]e|analisis|multi[- ]?step|complex|kompleks|refactor|regression|test plan|testing)/.test(t)) groups.add('ai');
                                                                                                
  if (mode === 'chat' && groups.size <= FOUNDATION_GROUPS.size) return null;
  return groups;
}

function shortlistTools(tools, { text, mode, previousToolNames = [] } = {}) {
  const annotated = annotateTools(tools);
  const groups = inferGroups(text, mode);
  if (!groups) return annotated;
  for (const name of previousToolNames) groups.add(String(name).split('.')[0]);
  const selected = annotated.filter((tool) => groups.has(tool.group || tool.name.split('.')[0]));
                                                                                                            
  return selected.length >= 2 ? selected : annotated;
}

class ToolFailureMemory {
  constructor({ maxSameStrategy = 2 } = {}) { this.maxSameStrategy = maxSameStrategy; this.entries = new Map(); }
  key(name, args) {
    let a = ''; try { a = JSON.stringify(args || {}); } catch { a = String(args); }
    return `${name}:${a.slice(0, 1000)}`;
  }
  record(name, args, error) {
    const key = this.key(name, args); const prev = this.entries.get(key) || { attempts: 0 };
    const next = { name, attempts: prev.attempts + 1, error: String(error || 'unknown error').slice(0, 500) };
    this.entries.set(key, next); return next;
  }
  shouldReplan(name, args) { return (this.entries.get(this.key(name, args))?.attempts || 0) >= this.maxSameStrategy; }
  promptNote() {
    if (!this.entries.size) return '';
    const rows = [...this.entries.values()].slice(-8).map((x) => `- ${x.name}: failed ${x.attempts}x; last error: ${x.error}`);
    return `TOOL FAILURE MEMORY (this task only):\n${rows.join('\n')}\nDo not blindly repeat an identical failed call. Re-observe, change arguments, use a safer fallback, or replan.`;
  }
}

const TOOL_INTELLIGENCE_NOTE = `Tool intelligence discipline:\n- Think hierarchically: goal -> needed capability -> safest relevant tool -> prerequisites -> execute -> verify.\n- Prefer the least risky, least costly tool that can reliably achieve the goal. Being possible with a tool does not make it the best tool.\n- Observe before acting when state may have changed. For browser actions, re-observe after navigation or DOM-changing actions; element IDs from old snapshots may be stale.\n- Define success from the user's goal, not from the absence of an exception. After consequential actions, verify the resulting state with an independent read/status/observation when practical.\n- Escalate gradually: structured/read-only inspection first, then direct action, then expensive/visual fallback only when needed.\n- If the same strategy fails twice, stop repeating it and replan or use a documented fallback.\n- Never bypass Guard, Permission, workspace boundaries, or user confirmation to make a tool succeed.`;

module.exports = { annotateTools, inferGroups, shortlistTools, ToolFailureMemory, TOOL_INTELLIGENCE_NOTE };
