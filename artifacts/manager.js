'use strict';
                                                                                             
const fs = require('fs');
const { uid, now } = require('../utils/misc');

class ArtifactManager {
  constructor(db) { this.db = db; }

  create({ workspaceId = null, taskId = null, name, path: filePath, type }) {
    const id = uid();
    this.db.run('INSERT INTO artifacts (id, workspace_id, task_id, name, path, type, created_at) VALUES (?,?,?,?,?,?,?)',
      [id, workspaceId, taskId, name, filePath, type, now()]);
    return this.get(id);
  }

  get(id) { return this.db.get('SELECT * FROM artifacts WHERE id = ?', [id]); }

  list(workspaceId) {
    return workspaceId
      ? this.db.all('SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at DESC', [workspaceId])
      : this.db.all('SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 200');
  }

  listForTask(taskId) { return this.db.all('SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at DESC', [taskId]); }

  rename(id, name) { this.db.run('UPDATE artifacts SET name = ? WHERE id = ?', [name, id]); return this.get(id); }

  remove(id, { deleteFile = false } = {}) {
    const a = this.get(id);
    if (a && deleteFile) { try { fs.unlinkSync(a.path); } catch { /* already gone */ } }
    this.db.run('DELETE FROM artifacts WHERE id = ?', [id]);
  }
}

module.exports = { ArtifactManager };
