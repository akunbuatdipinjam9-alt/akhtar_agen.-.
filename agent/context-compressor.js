'use strict';
                                                                                                           
function clip(s,n=900){ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n-1)+'…':s; }
function compressMessages(messages,{budgetChars=60000,recentCount=10,summaryChars=12000}={}){
  const all=Array.isArray(messages)?messages:[]; let total=all.reduce((n,m)=>n+String(m.content||'').length+JSON.stringify(m.toolCalls||'').length,0);
  if(total<=budgetChars)return {messages:all,compressed:false,savedChars:0,summary:''};
  const recent=all.slice(-recentCount), old=all.slice(0,-recentCount);
  const lines=[];
  for(const m of old){
    if(m.role==='tool') lines.push(`TOOL ${m.toolName||''}: ${clip(m.content,500)}`);
    else if(m.role==='user') lines.push(`USER: ${clip(m.content,800)}`);
    else if(m.role==='assistant') lines.push(`ASSISTANT: ${clip(m.content,800)}`);
  }
  let summary=lines.join('\n'); if(summary.length>summaryChars) summary=summary.slice(-summaryChars);
  const synthetic={role:'system',content:`[Compressed earlier conversation]\n${summary}`};
  let out=[synthetic,...recent];
                                                               
  while(out.length>2 && out.reduce((n,m)=>n+String(m.content||'').length,0)>budgetChars) out.splice(1,1);
  const after=out.reduce((n,m)=>n+String(m.content||'').length,0);
  return {messages:out,compressed:true,savedChars:Math.max(0,total-after),summary};
}
module.exports={compressMessages};
