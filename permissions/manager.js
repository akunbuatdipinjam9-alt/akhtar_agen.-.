'use strict';
   
                                                                   
  
          
                               
                                                                                        
                                                                                                
                                                                                           
                                            
                                                               
                                             
                               
  
                                                                                          
   
const { LEVEL } = require('./levels');
const { now } = require('../utils/misc');
const { logger } = require('../utils/logger');

class PermissionManager {
                                                                                                         
  constructor({ db, request }) {
    this.db = db;
    this.request = request;
  }

  _ws(workspaceId) { return workspaceId || 'global'; }

  getGrant(workspaceId, category) {
    const row = this.db.get('SELECT decision FROM permissions WHERE workspace_id = ? AND category = ?', [this._ws(workspaceId), category]);
    return row ? row.decision : null;
  }

  saveGrant(workspaceId, category, decision) {
    this.db.run(
      'INSERT INTO permissions (workspace_id, category, decision, created_at) VALUES (?,?,?,?) ON CONFLICT(workspace_id, category) DO UPDATE SET decision = excluded.decision, created_at = excluded.created_at',
      [this._ws(workspaceId), category, decision, now()],
    );
  }

  listGrants(workspaceId) {
    const ws = this._ws(workspaceId);
    return this.db.all('SELECT category, decision, created_at, workspace_id FROM permissions WHERE workspace_id IN (?, ?) ORDER BY category', [ws, 'global']);
  }

  revoke(workspaceId, category) {
    const scope = category === 'system.control' ? 'global' : this._ws(workspaceId);
    this.db.run('DELETE FROM permissions WHERE workspace_id = ? AND category = ?', [scope, category]);
  }

  async check({ level, category, mode, workspaceId, signal, request, lifetime = false }) {
    const allow = (how) => ({ allowed: true, how });
    const deny = (reason) => ({ allowed: false, reason });

                                                                                      
                                                                                          
    if (level === LEVEL.BLOCKED) return deny(request?.warning || 'This action is blocked by the safety policy.');
    if (lifetime && level !== LEVEL.CRITICAL && this.getGrant('global', category) === 'allow_always') return allow('lifetime_grant');

    switch (level) {
      case LEVEL.NONE:
      case LEVEL.READ:
        return allow('auto');
      case LEVEL.NETWORK:
        if (category === 'network.info') return allow('auto');
        if (this.getGrant(workspaceId, category) === 'allow_project') return allow('grant');
        return this._ask({ level, category, workspaceId, signal, request, allowProject: true, lifetime });
      case LEVEL.WRITE:
      case LEVEL.SENSITIVE:
        if (mode === 'agent' && this.getGrant(workspaceId, category) === 'allow_project') return allow('grant');
        return this._ask({ level, category, workspaceId, signal, request, allowProject: mode === 'agent', lifetime });
      case LEVEL.CRITICAL:
        return this._ask({ level, category, workspaceId, signal, request, allowProject: false });
      default:
        return deny(`Unknown permission level ${level}`);
    }
  }

     
                                                                              
                                                                            
                                                                            
                                                                          
                                                                         
                                               
     
  checkUnattended({ level, category, workspaceId, lifetime = false }) {
    const allow = (how) => ({ allowed: true, how });
    const deny = (reason) => ({ allowed: false, reason });
    if (level === LEVEL.BLOCKED) return deny('This action is blocked by the safety policy.');
    if (lifetime && level !== LEVEL.CRITICAL && this.getGrant('global', category) === 'allow_always') return allow('lifetime_grant');
    switch (level) {
      case LEVEL.NONE:
      case LEVEL.READ:
        return allow('auto');
      case LEVEL.NETWORK:
        if (category === 'network.info') return allow('auto');
        return this.getGrant(workspaceId, category) === 'allow_project' ? allow('grant') : deny(`No pre-approved permission for "${category}" — grant "Allow for Project" in a live session first, or this action is skipped when unattended.`);
      case LEVEL.WRITE:
      case LEVEL.SENSITIVE:
        return this.getGrant(workspaceId, category) === 'allow_project' ? allow('grant') : deny(`No pre-approved permission for "${category}" — grant "Allow for Project" in a live session first, or this action is skipped when unattended.`);
      case LEVEL.CRITICAL:
        return deny('Critical actions always need a live confirmation and are never allowed in an unattended run.');
      default:
        return deny(`Unknown permission level ${level}`);
    }
  }

  async _ask({ level, category, workspaceId, signal, request, allowProject, lifetime = false }) {
    if (signal?.aborted) return { allowed: false, reason: 'Run was stopped.' };
    const decision = await this.request({ ...request, level, category, allowProject, allowAlways: lifetime }, signal);
    logger.agent('info', 'Permission decision', { category, level, decision });
    if (decision === 'allow_always' && lifetime && level !== LEVEL.CRITICAL) {
      this.saveGrant('global', category, 'allow_always');
      return { allowed: true, how: 'lifetime_grant' };
    }
    if (decision === 'allow_project' && allowProject) {
      this.saveGrant(workspaceId, category, 'allow_project');
      return { allowed: true, how: 'granted_project' };
    }
    if (decision === 'allow_once' || decision === 'allow_project') return { allowed: true, how: 'once' };
    return { allowed: false, reason: 'The user denied this action.' };
  }
}

module.exports = { PermissionManager };
