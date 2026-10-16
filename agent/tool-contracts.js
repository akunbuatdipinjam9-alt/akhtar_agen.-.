'use strict';
                                                                                      
function auditToolContracts(registry){
 const issues=[]; const names=new Set();
 for(const t of registry.all()){
  if(names.has(t.name))issues.push({tool:t.name,issue:'duplicate'}); names.add(t.name);
  if(typeof t.execute!=='function')issues.push({tool:t.name,issue:'execute must be function'});
  if(!t.inputSchema||t.inputSchema.type!=='object')issues.push({tool:t.name,issue:'inputSchema must be object schema'});
  if(!t.group)issues.push({tool:t.name,issue:'missing group'});
                                                                            
  if(t.timeoutMs!==undefined && typeof t.timeoutMs!=='function' && (!Number.isFinite(t.timeoutMs)||t.timeoutMs<=0))issues.push({tool:t.name,issue:'invalid timeoutMs'});
 }
 return {ok:issues.length===0,total:registry.all().length,issues};
}
module.exports={auditToolContracts};
