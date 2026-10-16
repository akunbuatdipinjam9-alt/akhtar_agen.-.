'use strict';
const { LEVEL } = require('../../permissions/levels');
const { fetchJson } = require('../net');
const API = 'https://ummahapi.com';
const SOURCE = 'UmmahAPI (ummahapi.com)';
const net = { permission: LEVEL.NETWORK, category: 'network.info' };
function qs(obj){ const q=new URLSearchParams(); for(const [k,v] of Object.entries(obj||{})) if(v!==undefined&&v!==null&&v!=='') q.set(k,String(v)); return q.toString(); }
async function get(path, params, ctx){ const query=qs(params); const j=await fetchJson(`${API}${path}${query?'?'+query:''}`,{signal:ctx.signal}); if(j?.success===false) throw new Error(j.error||'UmmahAPI request failed'); return { ...(j?.data ?? j), source: SOURCE }; }

module.exports=[
 {...net,group:'moon',name:'moon.current',description:'Get Hijri date, moon phase, illumination, calculated crescent visibility, and next new moon. Astronomical/tabular data is not an official local rukyat determination.',inputSchema:{type:'object',properties:{date:{type:'string',description:'Optional YYYY-MM-DD'}}},execute:(a,ctx)=>get('/api/moon',{date:a.date},ctx)},
 {...net,group:'moon',name:'moon.phases',description:'Get upcoming astronomical new moons and expected crescent sighting dates.',inputSchema:{type:'object',properties:{count:{type:'integer',minimum:1,maximum:24}}},execute:(a,ctx)=>get('/api/moon/phases',{count:a.count||12},ctx)},
 {...net,group:'moon',name:'moon.months',description:'List all Hijri months with Arabic names and sacred-month metadata.',inputSchema:{type:'object',properties:{}},execute:(_,ctx)=>get('/api/moon/months',{},ctx)},
 {...net,group:'moon',name:'moon.to_hijri',description:'Convert Gregorian date to Hijri using UmmahAPI Kuwaiti tabular algorithm.',inputSchema:{type:'object',properties:{year:{type:'integer',minimum:622,maximum:2500},month:{type:'integer',minimum:1,maximum:12},day:{type:'integer',minimum:1,maximum:31}},required:['year','month','day']},execute:(a,ctx)=>get('/api/moon/hijri',a,ctx)},
 {...net,group:'moon',name:'moon.to_gregorian',description:'Convert Hijri date to Gregorian.',inputSchema:{type:'object',properties:{year:{type:'integer',minimum:1,maximum:2000},month:{type:'integer',minimum:1,maximum:12},day:{type:'integer',minimum:1,maximum:30}},required:['year','month','day']},execute:(a,ctx)=>get('/api/moon/gregorian',a,ctx)},
];
