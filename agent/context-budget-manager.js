'use strict';
   
                         
                                                                      
                                                                                                              
                                                                                       
   
const { compressMessages } = require('./context-compressor');

const textOf = (m) => String(m?.content || '');
const sizeOf = (m) => textOf(m).length + JSON.stringify(m?.toolCalls || '').length;
const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9_./-]{3,}/g) || []);
function overlapScore(a,b){ const A=words(a), B=words(b); let n=0; for(const x of A) if(B.has(x)) n++; return n; }
function clip(s,n){ s=String(s||'').trim(); return s.length>n?s.slice(0,Math.max(0,n-1))+'…':s; }

function relevantMemories(memories, query, limit=6){
  return (Array.isArray(memories)?memories:[])
    .map(m=>({ ...m, _score: overlapScore(query,m.content) }))
    .sort((a,b)=>b._score-a._score || String(b.created_at||'').localeCompare(String(a.created_at||'')))
    .filter((m,i)=>m._score>0 || i<2).slice(0,limit);
}

function buildMemoryContext(memories, query, maxChars=3500){
  const picked=relevantMemories(memories,query);
  if(!picked.length)return '';
  let out='RELEVANT DURABLE MEMORY\nUse only when relevant; current user instructions and verified workspace state take precedence.\n';
  for(const m of picked){ const line=`- ${clip(m.content,600)}\n`; if(out.length+line.length>maxChars)break; out+=line; }
  return out.trim();
}

function summarizeToolMessage(m, max=900){
  const name=m.toolName?` ${m.toolName}`:'';
  return { ...m, content:`[Tool observation${name}] ${clip(textOf(m),max)}` };
}

function manageContext(messages,{budgetChars=60000,recentCount=10,summaryChars=12000,toolObservationChars=900}={}){
  const all=Array.isArray(messages)?messages:[];
  const before=all.reduce((n,m)=>n+sizeOf(m),0);
  if(before<=budgetChars) return {messages:all,managed:false,compressed:false,savedChars:0,beforeChars:before,afterChars:before};

                                                                                            
  const base=compressMessages(all,{budgetChars,recentCount,summaryChars});
  let out=base.messages.map((m,i)=>{
                                                                                                 
    if(m.role==='tool' && i < base.messages.length-2 && textOf(m).length>toolObservationChars) return summarizeToolMessage(m,toolObservationChars);
    return m;
  });

                                                                                           
  while(out.length>2 && out.reduce((n,m)=>n+sizeOf(m),0)>budgetChars) out.splice(1,1);
  const after=out.reduce((n,m)=>n+sizeOf(m),0);
  return {messages:out,managed:true,compressed:true,savedChars:Math.max(0,before-after),beforeChars:before,afterChars:after};
}

function budgetSystemExtras({skillContext='',memoryContext='',projectKnowledge='',maxChars=30000}={}){
  const parts=[]; let used=0;
                                                                                        
  for(const [label,value] of [['SKILLS',skillContext],['MEMORY',memoryContext],['PROJECT',projectKnowledge]]){
    if(!value)continue; const room=Math.max(0,maxChars-used); if(!room)break;
    const v=clip(value,room); parts.push({label,text:v}); used+=v.length;
  }
  return {parts,usedChars:used,droppedChars:Math.max(0,String(skillContext).length+String(memoryContext).length+String(projectKnowledge).length-used)};
}

module.exports={manageContext,relevantMemories,buildMemoryContext,budgetSystemExtras};
