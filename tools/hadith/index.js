'use strict';
const { LEVEL } = require('../../permissions/levels');
const { fetchJson } = require('../net');
const API = 'https://ummahapi.com';
const SOURCE = 'UmmahAPI (ummahapi.com)';
const net = { permission: LEVEL.NETWORK, category: 'network.info' };
function qs(obj){ const q=new URLSearchParams(); for(const [k,v] of Object.entries(obj||{})) if(v!==undefined&&v!==null&&v!=='') q.set(k,String(v)); return q.toString(); }
async function get(path, params, ctx){ const query=qs(params); const j=await fetchJson(`${API}${path}${query?'?'+query:''}`,{signal:ctx.signal}); if(j?.success===false) throw new Error(j.error||'UmmahAPI request failed'); return { ...(j?.data ?? j), source: SOURCE }; }

const collections=['bukhari','muslim','abudawud','tirmidhi','ibnmajah','nasai','malik'];
module.exports=[
 {...net,group:'hadith',name:'hadith.collections',description:'List available Hadith collections from UmmahAPI.',inputSchema:{type:'object',properties:{}},execute:(_,ctx)=>get('/api/hadith/collections',{},ctx)},
 {...net,group:'hadith',name:'hadith.search',description:'Search Hadith text across all collections or one collection.',inputSchema:{type:'object',properties:{query:{type:'string'},collection:{type:'string',enum:collections},limit:{type:'integer',minimum:1,maximum:50}},required:['query']},execute:(a,ctx)=>get('/api/hadith/search',{q:a.query,collection:a.collection,limit:a.limit||25},ctx)},
 {...net,group:'hadith',name:'hadith.random',description:'Get a random Hadith, optionally from a collection.',inputSchema:{type:'object',properties:{collection:{type:'string',enum:collections}}},execute:(a,ctx)=>get('/api/hadith/random',{collection:a.collection},ctx)},
 {...net,group:'hadith',name:'hadith.browse',description:'Browse a Hadith collection with pagination.',inputSchema:{type:'object',properties:{collection:{type:'string',enum:collections},page:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:100}},required:['collection']},execute:(a,ctx)=>get(`/api/hadith/${encodeURIComponent(a.collection)}`,{page:a.page||1,limit:a.limit||50},ctx)},
 {...net,group:'hadith',name:'hadith.get',description:'Get one Hadith by collection and Hadith number.',inputSchema:{type:'object',properties:{collection:{type:'string',enum:collections},number:{type:['string','integer']}},required:['collection','number']},execute:(a,ctx)=>get(`/api/hadith/${encodeURIComponent(a.collection)}/${encodeURIComponent(String(a.number))}`,{},ctx)},
];
