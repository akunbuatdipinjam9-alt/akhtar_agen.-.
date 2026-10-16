'use strict';
const { fetchJson } = require('../tools/net');

const API = 'https://ummahapi.com';
const DAY = 24 * 60 * 60 * 1000;

const EVENTS = {
  '1-1': { id:'hijri-new-year', title:'Tahun Baru Hijriah', body:'عام هجري مبارك. Semoga tahun ini dipenuhi kebaikan, keberkahan, dan amal yang bermanfaat.' },
  '10-1': { id:'ashura', title:'Hari Asyura', body:'Hari Asyura telah tiba. Semoga Allah menerima amal baik dan memberi keberkahan kepada kita.' },
  '12-3': { id:'mawlid', title:'Maulid Nabi ﷺ', body:'اللهم صل وسلم على نبينا محمد. Semoga kita senantiasa meneladani akhlak Rasulullah ﷺ.' },
  '27-7': { id:'isra-miraj', title:'Isra Mikraj', body:'Memperingati Isra Mikraj. Semoga salat kita semakin terjaga dan mendekatkan diri kepada Allah.' },
  '1-9': { id:'ramadan', title:'Ramadan Mubarak', body:'رمضان مبارك. Semoga Ramadan ini dipenuhi rahmat, ampunan, dan amal yang diterima.' },
  '1-10': { id:'eid-fitr', title:'Eid Mubarak', body:'عيد فطر مبارك. أتمنى لكم دوام الصحة والبركات الوفيرة. 🙏' },
  '9-12': { id:'arafah', title:'Hari Arafah', body:'Hari Arafah telah tiba. Semoga Allah menerima doa dan amal baik kita.' },
  '10-12': { id:'eid-adha', title:'Eid Mubarak', body:'عيد أضحى مبارك. أتمنى لكم دوام الصحة والبركات الوفيرة. 🙏' },
};

function localIsoDate(d = new Date()) {
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

async function hijriFor(iso, signal) {
  const [year,month,day]=iso.split('-').map(Number);
  const q = new URLSearchParams({year:String(year),month:String(month),day:String(day)});
  const j = await fetchJson(`${API}/api/moon/hijri?${q}`, { signal });
  if (j?.success === false) throw new Error(j.error || 'UmmahAPI request failed');
  const d=j?.data ?? j;
  const h=d.hijri || d;
  const hy=Number(h.year ?? h.hijri_year ?? h.hijriYear);
  const hm=Number(h.month?.number ?? h.month ?? h.hijri_month ?? h.hijriMonth);
  const hd=Number(h.day ?? h.hijri_day ?? h.hijriDay);
  if(!hm || !hd) throw new Error('UmmahAPI Hijri response did not contain a usable month/day.');
  return { year:hy||null, month:hm, day:hd, raw:d };
}

class IslamicEventReminder {
  constructor(app) { this.app=app; this.timer=null; this.running=false; }
  settings(){ return this.app.settings.get().islamicEvents || {}; }
  enabled(){ return this.settings().enabled === true; }
  status(){ const s=this.settings(); return { enabled:this.enabled(), consentGranted:s.consentGranted===true, mode:s.mode||'important', lastNotified:s.lastNotified||null }; }
  enable({mode='important'}={}) {
    this.app.settings.update({ islamicEvents:{ enabled:true, consentGranted:true, mode, consentGrantedAt:new Date().toISOString() } });
    this.start();
    return this.status();
  }
  disable(){ this.app.settings.update({islamicEvents:{enabled:false}}); this.stop(); return this.status(); }
  async check({date=localIsoDate(), force=false, signal}={}) {
    if(!force && !this.enabled()) return {checked:false, reason:'disabled'};
    const h=await hijriFor(date, signal);
    const event=EVENTS[`${h.day}-${h.month}`] || null;
    if(!event) return {checked:true,date,hijri:h,event:null};
    const key=`${date}:${event.id}`;
    const s=this.settings();
    if(!force && s.lastNotified===key) return {checked:true,date,hijri:h,event,duplicate:true};
    let supported=false;
    try { const { Notification }=require('electron'); supported=Notification.isSupported(); if(supported) new Notification({title:`Akhtar Agent · ${event.title}`,body:event.body,silent:false}).show(); } catch {}
    if(!force) this.app.settings.update({islamicEvents:{lastNotified:key,lastChecked:date}});
    return {checked:true,date,hijri:h,event,notified:supported};
  }
  start(){ if(this.running || !this.enabled()) return; this.running=true; const run=()=>this.check().catch(()=>{}); run(); this.timer=setInterval(run, 30*60*1000); this.timer.unref?.(); }
  stop(){ if(this.timer) clearInterval(this.timer); this.timer=null; this.running=false; }
}
module.exports={IslamicEventReminder, EVENTS, hijriFor, localIsoDate};
