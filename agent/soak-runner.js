'use strict';
                                                            
async function runSoak({iterations=500,registry,shortlist}){
 const start=process.memoryUsage().heapUsed; let failures=0;
 for(let i=0;i<iterations;i++){
  try{const all=registry.all(); if(!all.length)throw new Error('empty registry'); if(shortlist)shortlist(all,{text:i%2?'read a file and inspect project':'check time and weather',mode:'agent'});}catch{failures++;}
  if(i%50===0) await new Promise(r=>setImmediate(r));
 }
 const end=process.memoryUsage().heapUsed;
 return {ok:failures===0,iterations,failures,heapStart:start,heapEnd:end,heapDelta:end-start};
}
module.exports={runSoak};
