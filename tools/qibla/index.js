'use strict';
const { LEVEL } = require('../../permissions/levels');
const { fetchJson } = require('../net');
const API = 'https://ummahapi.com';
const SOURCE = 'UmmahAPI (ummahapi.com)';
const net = { permission: LEVEL.NETWORK, category: 'network.info' };
function qs(obj){ const q=new URLSearchParams(); for(const [k,v] of Object.entries(obj||{})) if(v!==undefined&&v!==null&&v!=='') q.set(k,String(v)); return q.toString(); }
async function get(path, params, ctx){ const query=qs(params); const j=await fetchJson(`${API}${path}${query?'?'+query:''}`,{signal:ctx.signal}); if(j?.success===false) throw new Error(j.error||'UmmahAPI request failed'); return { ...(j?.data ?? j), source: SOURCE }; }

function valid(lat,lng){ if(typeof lat!=='number'||lat < -90||lat > 90) throw new Error('latitude must be between -90 and 90'); if(typeof lng!=='number'||lng < -180||lng > 180) throw new Error('longitude must be between -180 and 180'); }
module.exports=[
 {...net,group:'qibla',name:'qibla.direction',description:'Calculate Qibla compass bearing and distance to the Kaaba from user-approved coordinates. Bearing is relative to true north.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude']},async execute(a,ctx){valid(a.latitude,a.longitude);return get('/api/qibla',{lat:a.latitude,lng:a.longitude},ctx)}},
];
