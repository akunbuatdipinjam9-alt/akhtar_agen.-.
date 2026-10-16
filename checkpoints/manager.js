'use strict';
   
                                                                             
                                                                           
                                                                          
  
                                                                            
                                                                            
                                                                         
                                                                         
   
const fs = require('fs');
const crypto = require('crypto');
const { uid, now } = require('../utils/misc');
const { logger } = require('../utils/logger');
const path = require('path');

const KEEP_CHECKPOINTS_PER_WORKSPACE = 50;                                                          

function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;                                             
  }
}

class CheckpointManager {
  constructor(db) { this.db = db; }

  _ensure(ctx) {
    if (ctx._checkpointId) return ctx._checkpointId;
                                                                                        
                                                                  
    if (ctx.taskId) {
      const existing = this.db.get('SELECT id FROM checkpoints WHERE task_id = ? AND restored_at IS NULL ORDER BY created_at DESC', [ctx.taskId]);
      if (existing) { ctx._checkpointId = existing.id; return existing.id; }
    }
    this._prune(ctx.workspaceId);
    const id = uid();
    this.db.run('INSERT INTO checkpoints (id, workspace_id, task_id, label, created_at) VALUES (?,?,?,?,?)',
      [id, ctx.workspaceId, ctx.taskId || null, 'auto', now()]);
    ctx._checkpointId = id;
    return id;
  }

                                                                                                              
  record(ctx, { action, path: filePath, before, extra }) {
    const checkpointId = this._ensure(ctx);
    this.db.run(
      'INSERT INTO checkpoint_files (checkpoint_id, action, path, before, extra, created_at) VALUES (?,?,?,?,?,?)',
      [checkpointId, action, filePath, before ? before.toString('base64') : null, extra ? JSON.stringify(extra) : null, now()],
    );
    return checkpointId;
  }

     
                                                                               
                                                                               
                                                                
     
  recordPostState(checkpointId, filePath) {
    const row = this.db.get(
      'SELECT id, extra FROM checkpoint_files WHERE checkpoint_id = ? AND path = ? ORDER BY id DESC',
      [checkpointId, filePath],
    );
    if (!row) return false;
    const extra = row.extra ? JSON.parse(row.extra) : {};
    extra.after_hash = hashFile(filePath);
    this.db.run('UPDATE checkpoint_files SET extra = ? WHERE id = ?', [JSON.stringify(extra), row.id]);
    return true;
  }

     
                                                                             
                                                                             
                                                                          
                 
     
  checkConflicts(checkpointId) {
    const rows = this.db.all('SELECT * FROM checkpoint_files WHERE checkpoint_id = ? ORDER BY id DESC', [checkpointId]);
    const conflicts = [];
    for (const r of rows) {
      const extra = r.extra ? JSON.parse(r.extra) : {};
      if (extra.unrestorable || !extra.after_hash) continue;
      if (r.action === 'move' || r.action === 'mkdir' || r.action === 'copy_dir') continue;
      const current = fs.existsSync(r.path) ? hashFile(r.path) : null;
      if (current !== extra.after_hash) {
        conflicts.push({
          path: r.path,
          action: r.action,
          reason: current === null
            ? 'file was deleted or became unreadable after the task'
            : 'file was modified manually after the task',
        });
      }
    }
    return conflicts;
  }

  _prune(workspaceId) {
    try {
      const old = this.db.all('SELECT id FROM checkpoints WHERE workspace_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?', [workspaceId, KEEP_CHECKPOINTS_PER_WORKSPACE - 1]);
      for (const r of old) {
        this.db.run('DELETE FROM checkpoint_files WHERE checkpoint_id = ?', [r.id]);
        this.db.run('DELETE FROM checkpoints WHERE id = ?', [r.id]);
      }
    } catch (e) { logger.error('Checkpoint prune failed', e); }
  }

  listForWorkspace(workspaceId) {
    return this.db.all('SELECT * FROM checkpoints WHERE workspace_id = ? ORDER BY created_at DESC', [workspaceId]);
  }

  latest(workspaceId, taskId) {
    return taskId
      ? this.db.get('SELECT * FROM checkpoints WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC', [workspaceId, taskId])
      : this.db.get('SELECT * FROM checkpoints WHERE workspace_id = ? ORDER BY created_at DESC', [workspaceId]);
  }

     
                                                                                               
    
                
                                                                                 
                                                                              
                                                                  
                                                                           
     
  async restore(checkpointId, { force = false, backupConflicts = false } = {}) {
    const cp = this.db.get('SELECT * FROM checkpoints WHERE id = ?', [checkpointId]);
    if (!cp) throw new Error('Checkpoint not found.');
                                                                                         
    if (cp.restored_at) throw new Error('This checkpoint was already restored.');

    const conflicts = this.checkConflicts(checkpointId);
    if (conflicts.length && !force) {
      const e = new Error(
        `Restore blocked: ${conflicts.length} file(s) were changed manually after this task ` +
        `(${conflicts.slice(0, 5).map((c) => c.path).join(', ')}${conflicts.length > 5 ? ', …' : ''}). ` +
        'Confirm to overwrite, optionally keeping backups.',
      );
      e.conflicts = conflicts;
      throw e;
    }

    const conflictPaths = new Set(conflicts.map((c) => c.path));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rows = this.db.all('SELECT * FROM checkpoint_files WHERE checkpoint_id = ? ORDER BY id DESC', [checkpointId]);
    const results = [];
    for (const r of rows) {
      try {
        const extra = r.extra ? JSON.parse(r.extra) : {};
        if (extra.unrestorable) {
          results.push({ path: r.path, action: r.action, ok: false, error: extra.reason || 'No snapshot was kept for this change.' });
          continue;
        }
        if (backupConflicts && conflictPaths.has(r.path) && fs.existsSync(r.path)) {
          fs.copyFileSync(r.path, `${r.path}.backup-${stamp}`);
        }
        if (r.action === 'move') {
          if (extra.to && extra.from && fs.existsSync(extra.to)) {
            if (fs.existsSync(extra.from)) throw new Error(`Cannot move back: "${extra.from}" exists again.`);
            fs.mkdirSync(path.dirname(extra.from), { recursive: true });
            fs.renameSync(extra.to, extra.from);
          }
        } else if (r.action === 'mkdir') {
          // leave created folders in place; only file contents are reversed
        } else if (r.action === 'copy_dir') {
                                                                              
          const dest = extra.dest || r.path;
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        } else if (r.before === null) {
          if (fs.existsSync(r.path)) fs.unlinkSync(r.path);
        } else {
          fs.mkdirSync(path.dirname(r.path), { recursive: true });
          fs.writeFileSync(r.path, Buffer.from(r.before, 'base64'));
        }
        results.push({ path: r.path, action: r.action, ok: true });
      } catch (e) {
        logger.error(`Checkpoint restore failed for ${r.path}`, e);
        results.push({ path: r.path, action: r.action, ok: false, error: e.message });
      }
    }
    this.db.run('UPDATE checkpoints SET restored_at = ? WHERE id = ?', [now(), checkpointId]);
    return results;
  }
}

module.exports = { CheckpointManager };
