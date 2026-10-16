'use strict';
                                                                                            
const fs = require('fs');
const { spawnSync } = require('child_process');
const { logger } = require('../utils/logger');

const STATES = Object.freeze({ QUEUED:'queued', RUNNING:'running', VERIFYING:'verifying', SUCCESS:'success', FAILED:'failed', TIMEOUT:'timeout', CANCELLED:'cancelled', BLOCKED:'blocked' });
const TRANSITIONS = {
  queued:new Set(['running','cancelled','blocked']), running:new Set(['verifying','success','failed','timeout','cancelled','blocked']),
  verifying:new Set(['success','failed','timeout','cancelled']), success:new Set(), failed:new Set(), timeout:new Set(), cancelled:new Set(), blocked:new Set(),
};
function canTransition(from,to){ return !!TRANSITIONS[from]?.has(to); }
function classifyError(e){
  if(e?.securityBlocked || e?.permissionDenied) return 'permanent';
  if(e?.name==='AbortError') return e.reason==='timeout'?'timeout':'cancelled';
  const m=String(e?.message||e).toLowerCase();
  if(/429|rate.?limit|econnreset|econnrefused|etimedout|temporary|temporarily|network|fetch failed|503|502|504/.test(m)) return 'transient';
  if(/permission|denied|invalid|schema|not allowed|unsupported|not found/.test(m)) return 'permanent';
  return 'unknown';
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      const e = new Error('aborted');
      e.name = 'AbortError';
      e.reason = 'aborted';
      reject(e);
    };
    if (signal?.aborted) return onAbort();
    timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
async function withRetry(fn,{retries=2,baseDelayMs=250,signal,onRetry}={}){let last;for(let i=0;i<=retries;i++){try{return await fn(i)}catch(e){last=e;if(i>=retries||classifyError(e)!=='transient')throw e;onRetry?.(e,i+1);await sleep(baseDelayMs*(2**i),signal)}}throw last;}

async function verifyToolResult(tool,args,result,ctx){
  if(typeof tool.verify==='function'){const v=await tool.verify(args,result,ctx); if(v===false||v?.ok===false)throw new Error(v?.reason||`Verification failed for ${tool.name}`); return v||{ok:true};}
  if(result && result.verified===false) throw new Error(`Verification failed for ${tool.name}`);
  if(tool.name==='terminal.run' && (result?.exit_code!==0 || result?.timed_out || result?.cancelled)) throw new Error(`Terminal verification failed (exit=${result?.exit_code}, timeout=${!!result?.timed_out}, cancelled=${!!result?.cancelled})`);
  if(result?._beforeAfter) return {ok:true,mechanical:true,beforeAfter:true,confirmed:result._beforeAfter.confirmed===true,reason:result._beforeAfter.reason,signals:result._beforeAfter.signals||[]};
  return {ok:true,mechanical:!!result?.verified};
}

function commandExists(cmd,args=['--version']){try{const r=spawnSync(cmd,args,{timeout:2500,windowsHide:true,stdio:'ignore'});return !r.error;}catch{return false;}}
function runHealthCheck(app){
  const platform=process.platform; const checks=[];
  checks.push({id:'database',ok:!!app.db?.db,critical:true});
  checks.push({id:'registry',ok:(app.registry?.all?.().length||0)>0,critical:true,detail:`${app.registry?.all?.().length||0} tools`});
  checks.push({id:'artifacts_dir',ok:!!app.artifactsDir&&fs.existsSync(app.artifactsDir),critical:true});
  checks.push({id:'git',ok:commandExists('git'),critical:false});
  checks.push({id:'powershell',ok:platform!=='win32'||commandExists('powershell.exe',['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()']),critical:false});
  checks.push({id:'osascript',ok:platform!=='darwin'||commandExists('/usr/bin/osascript',['-e','return 1']),critical:false});
  const unhealthy=checks.filter(x=>!x.ok); const report={ok:!checks.some(x=>x.critical&&!x.ok),platform,checkedAt:Date.now(),checks,unhealthy:unhealthy.map(x=>x.id)};
  logger.app(report.ok?'info':'error','Stability health check',report); return report;
}
function recoverInterruptedTasks(tasks){
  const rows=tasks.db.all("SELECT id FROM tasks WHERE status IN ('running','verifying','queued')");
  for(const r of rows){tasks.update(r.id,{status:'interrupted',error:'Application exited before this task reached a terminal state.'});tasks.addEvent(r.id,'recovered_interruption','Task was marked interrupted during startup recovery. Resume will re-check uncertain state before continuing.');}
  const calls=tasks.db.all("SELECT id FROM tool_calls WHERE status IN ('running','verifying','queued')");
  for(const c of calls) tasks.finishToolCall(c.id,{status:'unknown',result:{error:'Application exited during tool execution. The action may or may not have completed; re-check state before retrying.',unknown:true}});
  return {tasks:rows.length,toolCalls:calls.length};
}
module.exports={STATES,canTransition,classifyError,withRetry,verifyToolResult,runHealthCheck,recoverInterruptedTasks};
