'use strict';
   
                                                          
  
                                      
                                                    
                                                          
                                                                      
  
                                                                                 
                                                                                 
   
const crypto = require('crypto');
const { LEVEL } = require('../../permissions/levels');

let activeSession = null;

const MATERIALS = {
  water: { id:'water', label:'Air', color:'#60a5fa', kind:'liquid', aliases:['air','water','h2o'] },
  salt: { id:'salt', label:'Garam', color:'#f8fafc', kind:'solid', aliases:['garam','salt','nacl','sodium chloride'] },
  sugar: { id:'sugar', label:'Gula', color:'#fef3c7', kind:'solid', aliases:['gula','sugar','sucrose','sukrosa'] },
  oil: { id:'oil', label:'Minyak', color:'#facc15', kind:'liquid', aliases:['minyak','oil','cooking oil'] },
  food_coloring: { id:'food_coloring', label:'Pewarna makanan', color:'#a78bfa', kind:'liquid', aliases:['pewarna','pewarna makanan','food coloring','food colour'] },
  vinegar: { id:'vinegar', label:'Cuka', color:'#e0f2fe', kind:'liquid', aliases:['cuka','vinegar'] },
  baking_soda: { id:'baking_soda', label:'Soda kue', color:'#f1f5f9', kind:'solid', aliases:['soda kue','baking soda','sodium bicarbonate','natrium bikarbonat'] },
  lemon: { id:'lemon', label:'Air lemon', color:'#fde047', kind:'liquid', aliases:['lemon','air lemon','lemon juice'] },
  cabbage_indicator: { id:'cabbage_indicator', label:'Indikator kol ungu', color:'#8b5cf6', kind:'liquid', aliases:['kol ungu','indikator kol ungu','red cabbage indicator','cabbage indicator'] },
  ice: { id:'ice', label:'Es', color:'#bae6fd', kind:'solid', aliases:['es','ice'] },
  mystery: { id:'mystery', label:'Zat misterius', color:'#94a3b8', kind:'unknown', aliases:[] },
};

const HAZARDOUS_PATTERNS = [
  /\b(?:bleach|pemutih|chlorine|klorin|ammonia|amonia)\b/i,
  /\b(?:sodium metal|natrium logam|potassium|kalium|lithium metal|litium logam)\b/i,
  /\b(?:gasoline|petrol|bensin|kerosene|minyak tanah|fuel)\b/i,
  /\b(?:strong acid|asam kuat|sulfuric|sulphuric|sulfurat|nitric acid|asam nitrat|hydrochloric|asam klorida)\b/i,
  /\b(?:strong base|basa kuat|sodium hydroxide|natrium hidroksida|potassium hydroxide|kalium hidroksida)\b/i,
  /\b(?:peroxide|peroksida|explosive|peledak|gunpowder|mesiu|thermite|termit)\b/i,
];

function clean(v) { return String(v ?? '').trim(); }
function norm(v) { return clean(v).toLowerCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' '); }

function materialFromName(name) {
  const n = norm(name);
  for (const item of Object.values(MATERIALS)) {
    if (item.id.replace(/_/g,' ') === n || item.aliases.some((a) => norm(a) === n)) return { ...item, input: clean(name) };
  }
  return { ...MATERIALS.mystery, label: clean(name) || 'Zat misterius', input: clean(name) || 'unknown' };
}

function isHazardous(names) {
  const raw = (names || []).map(clean);
  const joined = raw.join(' | ');
  if (raw.some((v) => ['sodium','natrium','potassium','kalium','lithium','litium'].includes(norm(v)))) return true;
  return HAZARDOUS_PATTERNS.some((re) => re.test(joined));
}

function has(ids, ...wanted) { return wanted.every((id) => ids.includes(id)); }
function clamp(n, min, max, fallback) { const x = Number(n); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback; }
function round(n, dp=2) { const p = 10 ** dp; return Math.round(n*p)/p; }

function chemistryScene(rawMaterials = []) {
  const materials = rawMaterials.slice(0, 5).map(materialFromName);
  const ids = materials.map((m) => m.id);
  const raw = rawMaterials.map(clean);

  if (isHazardous(raw)) {
    return {
      domain:'chemistry', scene:'restricted', effect:'concept_only', title:'Simulasi Konsep Aman',
      materials, safetyLevel:'concept-only', xp:15,
      summary:'Kombinasi ini berpotensi berbahaya di dunia nyata. Akhtar Lab hanya menampilkan konsep umum tanpa langkah, takaran, kondisi, atau petunjuk praktik.',
      concept:'Perubahan energi, pembentukan gas, panas, atau produk reaktif dapat membuat beberapa campuran tidak aman untuk dicoba sendiri.',
      equation:null,
      challenge:'Coba tanyakan ke AI: “energi apa yang berubah pada simulasi ini?”',
    };
  }

  if (has(ids, 'water', 'salt')) return {
    domain:'chemistry', scene:'beaker', effect:'dissolve', title:'Garam Bertemu Air', materials, safetyLevel:'safe-virtual', xp:10,
    summary:'Kristal garam tampak menghilang karena partikel penyusunnya tersebar di antara molekul air.',
    concept:'Pelarutan dan interaksi ion–dipol.', equation:'NaCl(s) → Na⁺(aq) + Cl⁻(aq)', challenge:'Menurutmu, apakah garam benar-benar hilang?',
  };
  if (has(ids, 'water', 'sugar')) return {
    domain:'chemistry', scene:'beaker', effect:'dissolve', title:'Gula Larut', materials, safetyLevel:'safe-virtual', xp:10,
    summary:'Molekul gula menyebar ke seluruh air tanpa berubah menjadi zat baru.',
    concept:'Pelarutan molekuler — perubahan fisika, bukan reaksi kimia.', equation:null, challenge:'Apa bedanya “larut” dengan “bereaksi”?',
  };
  if (has(ids, 'water', 'oil')) return {
    domain:'chemistry', scene:'beaker', effect:'layers', title:'Air + Minyak', materials, safetyLevel:'safe-virtual', xp:10,
    summary:'Minyak dan air membentuk lapisan karena sifat polaritasnya berbeda dan tidak mudah bercampur.',
    concept:'Polaritas, kelarutan, dan perbedaan massa jenis.', equation:null, challenge:'Kenapa minyak cenderung berada di bagian atas?',
  };
  if (has(ids, 'water', 'food_coloring')) return {
    domain:'chemistry', scene:'beaker', effect:'diffusion', title:'Jejak Warna Menyebar', materials, safetyLevel:'safe-virtual', xp:10,
    summary:'Warna menyebar dari daerah berkonsentrasi tinggi ke daerah yang lebih rendah.',
    concept:'Difusi partikel dalam cairan.', equation:null, challenge:'Apa yang terjadi kalau gerak partikelnya lebih cepat?',
  };
  if (has(ids, 'vinegar', 'baking_soda')) return {
    domain:'chemistry', scene:'beaker', effect:'fizz', title:'Gelembung CO₂', materials, safetyLevel:'safe-virtual', xp:12,
    summary:'Model menunjukkan pembentukan gelembung gas sebagai tanda terjadinya reaksi kimia.',
    concept:'Reaksi asam–basa yang menghasilkan karbon dioksida.', equation:null, challenge:'Dari mana gelembung pada simulasi berasal?',
  };
  if (has(ids, 'lemon', 'cabbage_indicator')) return {
    domain:'chemistry', scene:'beaker', effect:'indicator_acid', title:'Detektif Asam', materials, safetyLevel:'safe-virtual', xp:12,
    summary:'Indikator virtual berubah ke arah merah muda saat lingkungan lebih asam.',
    concept:'Indikator asam–basa dan perubahan struktur pigmen.', equation:null, challenge:'Warna apa yang kamu harapkan untuk larutan yang lebih basa?',
  };
  if (has(ids, 'ice', 'salt')) return {
    domain:'chemistry', scene:'beaker', effect:'cold', title:'Es + Garam', materials, safetyLevel:'safe-virtual', xp:12,
    summary:'Model menurunkan titik beku campuran sehingga es dapat mencair pada suhu yang lebih rendah.',
    concept:'Penurunan titik beku (sifat koligatif).', equation:null, challenge:'Kenapa menambah zat terlarut bisa mengubah titik beku?',
  };

  return {
    domain:'chemistry', scene:'beaker', effect:'mix', title:'Campuran Virtual', materials, safetyLevel:'safe-virtual', xp:6,
    summary:'Akhtar Lab tidak memiliki model reaksi khusus untuk kombinasi ini, jadi ia hanya menampilkan pencampuran partikel secara konseptual.',
    concept:'Tidak semua zat yang dicampur langsung bereaksi. Kadang hanya terbentuk campuran.', equation:null,
    challenge:'Tanya AI: “apakah kombinasi ini bereaksi atau hanya bercampur?”',
  };
}

function physicsScene(experiment, params = {}) {
  const e = norm(experiment || 'projectile');
  if (['projectile','gerak parabola','parabola','lemparan'].includes(e)) {
    const angle = clamp(params.angle_deg ?? params.angle, 5, 85, 45);
    const velocity = clamp(params.velocity_mps ?? params.velocity, 1, 35, 16);
    const g = 9.81, rad = angle * Math.PI / 180;
    const flight = (2 * velocity * Math.sin(rad)) / g;
    const range = (velocity * velocity * Math.sin(2*rad)) / g;
    const height = (velocity * velocity * Math.sin(rad) ** 2) / (2*g);
    return { domain:'physics', experiment:'projectile', scene:'projectile', effect:'projectile', title:'Peluncur Bola Virtual', safetyLevel:'safe-virtual', xp:12,
      params:{ angle_deg:angle, velocity_mps:velocity }, metrics:{ flight_time_s:round(flight), range_m:round(range), max_height_m:round(height) },
      summary:`Bola virtual diluncurkan pada sudut ${angle}° dengan kecepatan ${velocity} m/s.`,
      concept:'Gerak parabola: komponen horizontal hampir konstan sementara komponen vertikal dipengaruhi gravitasi.',
      challenge:'Coba ubah sudut. Sudut berapa yang menghasilkan jangkauan paling jauh pada model tanpa hambatan udara?'};
  }
  if (['pendulum','bandul'].includes(e)) {
    const length = clamp(params.length_m ?? params.length, 0.2, 3, 1);
    const gravity = clamp(params.gravity ?? params.g, 1, 20, 9.81);
    const period = 2*Math.PI*Math.sqrt(length/gravity);
    return { domain:'physics', experiment:'pendulum', scene:'pendulum', effect:'pendulum', title:'Bandul Ceria', safetyLevel:'safe-virtual', xp:10,
      params:{ length_m:length, gravity }, metrics:{ period_s:round(period) },
      summary:'Bandul virtual berayun bolak-balik dan memperlihatkan hubungan panjang tali dengan periode.',
      concept:'Untuk sudut kecil, periode terutama dipengaruhi panjang bandul dan gravitasi.',
      challenge:'Apa yang terjadi pada periode jika tali dibuat lebih panjang?'};
  }
  if (['spring','pegas'].includes(e)) {
    const mass = clamp(params.mass_kg ?? params.mass, 0.1, 5, 1);
    const k = clamp(params.spring_k ?? params.k, 2, 100, 20);
    const period = 2*Math.PI*Math.sqrt(mass/k);
    return { domain:'physics', experiment:'spring', scene:'spring', effect:'spring', title:'Pegas Pantul', safetyLevel:'safe-virtual', xp:10,
      params:{ mass_kg:mass, spring_k:k }, metrics:{ period_s:round(period) },
      summary:'Massa virtual bergerak naik-turun pada pegas.', concept:'Gerak harmonik sederhana dan Hukum Hooke.',
      challenge:'Kalau massa ditambah, apakah ayunannya menjadi lebih cepat atau lebih lambat?'};
  }
  if (['buoyancy','apung','massa jenis','density'].includes(e)) {
    const objectDensity = clamp(params.object_density ?? params.density, 100, 5000, 700);
    const liquidDensity = clamp(params.liquid_density, 500, 2000, 1000);
    const floats = objectDensity < liquidDensity;
    return { domain:'physics', experiment:'buoyancy', scene:'buoyancy', effect:floats?'float':'sink', title:'Tenggelam atau Mengapung?', safetyLevel:'safe-virtual', xp:10,
      params:{ object_density:objectDensity, liquid_density:liquidDensity }, metrics:{ floats },
      summary:`Benda virtual ${floats?'mengapung':'tenggelam'} karena massa jenisnya ${floats?'lebih kecil':'lebih besar'} daripada cairan.`,
      concept:'Gaya apung dan massa jenis.', challenge:'Ubah massa jenis benda sampai tepat di batas antara tenggelam dan mengapung.'};
  }
  return physicsScene('projectile', params);
}

function serializeSession(session) {
  return { id:session.id, createdAt:session.createdAt, updatedAt:session.updatedAt, paused:session.paused, speed:session.speed, scene:session.scene };
}

function sendLabEvent(ctx, type, session, extra = {}) {
  ctx.app.getWindow?.()?.webContents.send('lab:event', { type, session: serializeSession(session), ...extra });
}

function newSession(scene) {
  const now = new Date().toISOString();
  return { id:`lab-${crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex')}`, createdAt:now, updatedAt:now, paused:false, speed:1, scene };
}

function createScene(args) {
  const domain = args.domain || (args.materials?.length ? 'chemistry' : 'physics');
  return domain === 'physics' ? physicsScene(args.experiment || 'projectile', args.params || {}) : chemistryScene(args.materials || ['water','salt']);
}

function currentOrThrow(sessionId) {
  if (!activeSession) throw new Error('Belum ada eksperimen aktif. Jalankan lab.simulate terlebih dahulu.');
  if (sessionId && activeSession.id !== sessionId) throw new Error('Sesi Lab itu sudah tidak aktif. Mulai atau buka sesi baru.');
  return activeSession;
}

const base = { group:'lab', permission:LEVEL.NONE, category:'none', toolIntelligence:{ risk:'none', sideEffects:false } };

module.exports = [
  {
    ...base,
    name:'lab.simulate',
    description:'Open Akhtar Lab and start a playful interactive VIRTUAL science simulation for learning. For chemistry, pass the substances/materials the user wants to explore. For physics, pass a safe classroom experiment such as projectile, pendulum, spring, or buoyancy. This never performs a real-world experiment. If materials are potentially hazardous, the Lab automatically switches to concept-only mode and must not provide quantities, procedure, conditions, or practical instructions.',
    inputSchema:{ type:'object', properties:{
      domain:{ type:'string', enum:['chemistry','physics'] },
      materials:{ type:'array', items:{type:'string'}, maxItems:5, description:'Virtual substances, e.g. ["water","salt"]. Chemistry only.' },
      experiment:{ type:'string', maxLength:80, description:'Physics experiment name, e.g. projectile, pendulum, spring, buoyancy.' },
      params:{ type:'object', description:'Optional numeric simulation parameters such as angle_deg, velocity_mps, length_m, mass_kg.' },
    }},
    async execute(args, ctx) {
      activeSession = newSession(createScene(args || {}));
      sendLabEvent(ctx, 'open', activeSession);
      return { opened:true, virtual_only:true, session:serializeSession(activeSession), note:'Interactive Akhtar Lab opened in the app. Hazardous chemistry is concept-only.' };
    },
  },
  {
    ...base,
    name:'lab.modify',
    description:'Modify the currently open Akhtar Lab simulation without starting a separate tool chain. Use this after the user says things like “add salt”, “change the angle to 60°”, “make the pendulum longer”, “pause”, “resume”, or “restart”.',
    inputSchema:{ type:'object', properties:{
      session_id:{ type:'string' },
      materials:{ type:'array', items:{type:'string'}, maxItems:5 },
      add_material:{ type:'string', maxLength:80 },
      remove_material:{ type:'string', maxLength:80 },
      experiment:{ type:'string', maxLength:80 },
      params:{ type:'object' },
      action:{ type:'string', enum:['update','pause','resume','restart'] },
      speed:{ type:'number', minimum:0.25, maximum:3 },
    }},
    async execute(args, ctx) {
      const session = currentOrThrow(args.session_id);
      if (args.action === 'pause') session.paused = true;
      if (args.action === 'resume') session.paused = false;
      if (args.speed != null) session.speed = clamp(args.speed, .25, 3, 1);

      if (session.scene.domain === 'chemistry') {
        let names = (args.materials?.length ? args.materials : session.scene.materials.map((m) => m.input || m.label));
        if (args.add_material) names = [...names, args.add_material].slice(0,5);
        if (args.remove_material) {
          const remove = norm(args.remove_material);
          names = names.filter((n) => norm(n) !== remove && materialFromName(n).id.replace(/_/g,' ') !== remove);
        }
        if (args.materials || args.add_material || args.remove_material || args.action === 'restart') session.scene = chemistryScene(names);
      } else if (session.scene.domain === 'physics') {
        const currentParams = { ...(session.scene.params || {}), ...(args.params || {}) };
        const experiment = args.experiment || session.scene.experiment || session.scene.scene || 'projectile';
        if (args.params || args.experiment || args.action === 'restart') session.scene = physicsScene(experiment, currentParams);
      }
      session.updatedAt = new Date().toISOString();
      sendLabEvent(ctx, 'update', session);
      return { updated:true, virtual_only:true, session:serializeSession(session) };
    },
  },
  {
    ...base,
    name:'lab.explain',
    description:'Read the science explanation/facts for the current Akhtar Lab scene so the AI can answer a child-friendly follow-up question. This is a read-only virtual-lab tool. Do not turn hazardous concept-only scenes into real-world procedures.',
    inputSchema:{ type:'object', properties:{ session_id:{type:'string'}, question:{type:'string',maxLength:500} } },
    async execute(args, ctx) {
      const session = currentOrThrow(args.session_id);
      sendLabEvent(ctx, 'focus_fact', session, { question:clean(args.question) || null });
      const s = session.scene;
      return {
        session_id:session.id, domain:s.domain, title:s.title, summary:s.summary, concept:s.concept,
        equation:s.equation || null, metrics:s.metrics || null, challenge:s.challenge || null,
        safety_level:s.safetyLevel, virtual_only:true,
        safety_note:s.safetyLevel === 'concept-only' ? 'Keep the explanation conceptual only: no quantities, procedure, conditions, acquisition, or real-world execution steps.' : null,
      };
    },
  },
];

module.exports.helpers = { MATERIALS, materialFromName, isHazardous, chemistryScene, physicsScene, _reset:()=>{activeSession=null;} };
