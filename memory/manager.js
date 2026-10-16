'use strict';
   
                                                  
                                                                           
                                                                                 
                                                                                            
   
const { uid, now } = require('../utils/misc');
const { containsSecret } = require('../utils/logger');

class MemoryManager {
  constructor(db) { this.db = db; }

  assertStorable(content) {
    const text = String(content || '').trim();
    if (!text) throw new Error('Memory content is empty.');
    if (text.length > 500) throw new Error('Memory content is too long (max 500 chars).');
    if (containsSecret(text)) throw new Error('Refusing to store this: it looks like it contains a password, API key or other credential.');
  }

  list(workspaceId) {
    const rows = workspaceId
      ? this.db.all('SELECT * FROM memories WHERE scope = ? OR (scope = ? AND workspace_id = ?) ORDER BY created_at DESC', ['global', 'project', workspaceId])
      : this.db.all('SELECT * FROM memories WHERE scope = ? ORDER BY created_at DESC', ['global']);
    return rows;
  }

  add({ scope, workspaceId, content }) {
    this.assertStorable(content);
    if (scope !== 'global' && scope !== 'project') throw new Error(`Invalid memory scope "${scope}" (use global or project).`);
                                                                                                      
    if (scope === 'project' && !workspaceId) throw new Error('Project memory needs an open workspace; save it as global instead.');
    const id = uid();
    this.db.run('INSERT INTO memories (id, scope, workspace_id, content, created_at) VALUES (?,?,?,?,?)',
      [id, scope, scope === 'project' ? workspaceId : null, String(content).trim(), now()]);
    return { id, scope, workspaceId: scope === 'project' ? workspaceId : null, content };
  }

  remove(id) { this.db.run('DELETE FROM memories WHERE id = ?', [id]); }
}

module.exports = { MemoryManager };
