'use strict';
                                                              
const { uid, now } = require('../utils/misc');

const parseJSON = (s, fb = null) => { if (!s) return fb; try { return JSON.parse(s); } catch { return fb; } };

function mapWorkspace(r) {
  return r && { id: r.id, name: r.name, root_path: r.root_path, meta: parseJSON(r.meta, {}), created_at: r.created_at, updated_at: r.updated_at };
}
function mapMessage(r) {
  return r && {
    id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content || '',
    toolCalls: parseJSON(r.tool_calls, null), toolCallId: r.tool_call_id || null,
    toolName: r.tool_name || null, meta: parseJSON(r.meta, {}), createdAt: r.created_at,
  };
}

class Repos {
  constructor(db) { this.db = db; }

                                     
  listWorkspaces() { return this.db.all('SELECT * FROM workspaces ORDER BY updated_at DESC').map(mapWorkspace); }
  getWorkspace(id) { return id ? mapWorkspace(this.db.get('SELECT * FROM workspaces WHERE id = ?', [id])) : null; }
  findWorkspaceByRoot(root) { return mapWorkspace(this.db.get('SELECT * FROM workspaces WHERE root_path = ?', [root])); }
  createWorkspace({ name, rootPath = null, meta = {} }) {
    const id = uid();
    const t = now();
    this.db.run('INSERT INTO workspaces (id, name, root_path, meta, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [id, name, rootPath, JSON.stringify(meta), t, t]);
    return this.getWorkspace(id);
  }
  updateWorkspace(id, { name, meta }) {
    const ws = this.getWorkspace(id);
    if (!ws) throw new Error('Workspace not found');
    this.db.run('UPDATE workspaces SET name = ?, meta = ?, updated_at = ? WHERE id = ?',
      [name ?? ws.name, JSON.stringify(meta ?? ws.meta), now(), id]);
    return this.getWorkspace(id);
  }
  touchWorkspace(id) { if (id) this.db.run('UPDATE workspaces SET updated_at = ? WHERE id = ?', [now(), id]); }
  deleteWorkspace(id) {
    this.db.transaction(() => {
      for (const c of this.db.all('SELECT id FROM conversations WHERE workspace_id = ?', [id])) this._deleteConversationRows(c.id);
      this.db.run('DELETE FROM permissions WHERE workspace_id = ?', [id]);
      this.db.run('DELETE FROM memories WHERE workspace_id = ?', [id]);
      this.db.run('DELETE FROM checkpoint_files WHERE checkpoint_id IN (SELECT id FROM checkpoints WHERE workspace_id = ?)', [id]);
      this.db.run('DELETE FROM checkpoints WHERE workspace_id = ?', [id]);
      this.db.run('DELETE FROM workspaces WHERE id = ?', [id]);
    });
  }

                                        
  listConversations(workspaceId) {
    return workspaceId
      ? this.db.all('SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC', [workspaceId])
      : this.db.all('SELECT * FROM conversations WHERE workspace_id IS NULL ORDER BY updated_at DESC');
  }
  getConversation(id) { return this.db.get('SELECT * FROM conversations WHERE id = ?', [id]); }
  createConversation({ workspaceId = null, title = 'New chat', mode = 'assist' }) {
    const id = uid();
    const t = now();
    this.db.run('INSERT INTO conversations (id, workspace_id, title, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [id, workspaceId, title, mode, t, t]);
    return this.getConversation(id);
  }
  updateConversation(id, { title, mode }) {
    const c = this.getConversation(id);
    if (!c) throw new Error('Conversation not found');
    this.db.run('UPDATE conversations SET title = ?, mode = ?, updated_at = ? WHERE id = ?',
      [title ?? c.title, mode ?? c.mode, now(), id]);
    return this.getConversation(id);
  }
  _deleteConversationRows(id) {
    this.db.run('DELETE FROM messages WHERE conversation_id = ?', [id]);
    this.db.run('DELETE FROM todos WHERE task_id IN (SELECT id FROM tasks WHERE conversation_id = ?)', [id]);
    this.db.run('DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE conversation_id = ?)', [id]);
    this.db.run('DELETE FROM tasks WHERE conversation_id = ?', [id]);
    this.db.run('DELETE FROM tool_calls WHERE conversation_id = ?', [id]);
    this.db.run('DELETE FROM conversations WHERE id = ?', [id]);
  }
  deleteConversation(id) { this.db.transaction(() => this._deleteConversationRows(id)); }

                                   
  listMessages(conversationId) {
    return this.db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid', [conversationId]).map(mapMessage);
  }
  getMessage(id) { return mapMessage(this.db.get('SELECT * FROM messages WHERE id = ?', [id])); }
  addMessage({ id = uid(), conversationId, role, content = '', toolCalls = null, toolCallId = null, toolName = null, meta = {} }) {
    this.db.run(
      'INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tool_name, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, conversationId, role, content, toolCalls && toolCalls.length ? JSON.stringify(toolCalls) : null, toolCallId, toolName, JSON.stringify(meta), now()],
    );
    this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now(), conversationId]);
    return this.getMessage(id);
  }
  updateMessageContent(id, content) { this.db.run('UPDATE messages SET content = ? WHERE id = ?', [content, id]); }
                                                                               
  deleteMessagesAfter(conversationId, messageId) {
    const row = this.db.get('SELECT rowid AS r FROM messages WHERE id = ? AND conversation_id = ?', [messageId, conversationId]);
    if (!row) throw new Error('Message not found');
    this.db.run('DELETE FROM messages WHERE conversation_id = ? AND rowid > ?', [conversationId, row.r]);
  }
  lastUserMessage(conversationId) {
    return mapMessage(this.db.get("SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY rowid DESC LIMIT 1", [conversationId]));
  }
  lastUserMessageBefore(conversationId, timestamp) {
    return mapMessage(this.db.get("SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' AND created_at <= ? ORDER BY rowid DESC LIMIT 1", [conversationId, timestamp]));
  }
}

module.exports = { Repos, parseJSON };
