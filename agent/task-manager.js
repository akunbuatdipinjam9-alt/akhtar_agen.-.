'use strict';
                                                                                                
const { uid, now } = require('../utils/misc');

class TaskManager {
  constructor(db) { this.db = db; }

  create({ conversationId, workspaceId = null, title, mode }) {
    const id = uid();
    const t = now();
    this.db.run('INSERT INTO tasks (id, conversation_id, workspace_id, title, status, mode, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, conversationId, workspaceId, title.slice(0, 200), 'running', mode, null, t, t]);
    return this.get(id);
  }

  get(id) { return this.db.get('SELECT * FROM tasks WHERE id = ?', [id]); }

  listForConversation(conversationId) {
    return this.db.all('SELECT * FROM tasks WHERE conversation_id = ? ORDER BY created_at DESC', [conversationId]);
  }

  update(id, { status, error }) {
    const t = this.get(id);
    if (!t) return null;
    this.db.run('UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?',
      [status ?? t.status, error === undefined ? t.error : error, now(), id]);
    return this.get(id);
  }

  addEvent(taskId, type, message, data) {
    this.db.run('INSERT INTO task_events (task_id, type, message, data, created_at) VALUES (?,?,?,?,?)',
      [taskId, type, message || null, data ? JSON.stringify(data) : null, now()]);
  }

  listEvents(taskId) {
    return this.db.all('SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC', [taskId]);
  }

  listToolCalls(taskId) {
    return this.db.all('SELECT * FROM tool_calls WHERE task_id = ? ORDER BY started_at ASC', [taskId]);
  }

  timeline(taskId) {
    const events = this.listEvents(taskId).map(e => ({ kind: 'event', ...e }));
    const tools = this.listToolCalls(taskId).map(t => ({ kind: 'tool', ...t, created_at: t.started_at }));
                                                                                                         
    return [...events, ...tools].sort((a,b) => (a.created_at||0) - (b.created_at||0) || String(a.id??'').localeCompare(String(b.id??''), undefined, { numeric: true }));
  }

  logToolCall({ id = uid(), taskId, conversationId, name, args }) {
    this.db.run('INSERT INTO tool_calls (id, task_id, conversation_id, name, args, result, status, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, taskId, conversationId, name, JSON.stringify(args ?? {}), null, 'running', now(), null]);
    return id;
  }

  setToolCallState(id, status, result) {
    this.db.run('UPDATE tool_calls SET status = ?, result = COALESCE(?, result), finished_at = CASE WHEN ? IN (\'success\',\'failed\',\'error\',\'timeout\',\'cancelled\',\'blocked\',\'interrupted\') THEN ? ELSE finished_at END WHERE id = ?',
      [status, result === undefined ? null : JSON.stringify(result), status, now(), id]);
  }

  finishToolCall(id, { status, result }) {
    this.db.run('UPDATE tool_calls SET status = ?, result = ?, finished_at = ? WHERE id = ?',
      [status, JSON.stringify(result ?? null), now(), id]);
  }


  listResumable(limit = 12) {
    const rows = this.db.all("SELECT * FROM tasks WHERE status = 'interrupted' ORDER BY updated_at DESC LIMIT ?", [Math.max(1, Math.min(50, Number(limit) || 12))]);
    return rows.map((task) => {
      const calls = this.listToolCalls(task.id);
      const completed = calls.filter((c) => c.status === 'success').length;
      const uncertain = calls.filter((c) => c.status === 'unknown' || c.status === 'interrupted' || c.status === 'running' || c.status === 'verifying').length;
      const last = calls[calls.length - 1] || null;
      return { ...task, progress: { completed, total: calls.length, uncertain }, last_tool: last ? { name: last.name, status: last.status, started_at: last.started_at } : null };
    });
  }

  resumeContext(taskId) {
    const task = this.get(taskId);
    if (!task) throw new Error('Task not found');
    const calls = this.listToolCalls(taskId);
    const parse = (v, fb = null) => { try { return v ? JSON.parse(v) : fb; } catch { return fb; } };
    const uncertain = calls.filter((c) => ['unknown','interrupted','running','verifying'].includes(c.status)).map((c) => ({
      id: c.id, name: c.name, status: c.status, args: parse(c.args, {}), result: parse(c.result, null), started_at: c.started_at,
    }));
    const completed = calls.filter((c) => c.status === 'success').slice(-12).map((c) => ({ name: c.name, status: c.status, finished_at: c.finished_at }));
    const resumes = this.db.all("SELECT * FROM task_events WHERE task_id = ? AND type = 'resume_started' ORDER BY id ASC", [taskId]).length;
    return { task, uncertain, completed, resume_count: resumes };
  }

  resume(id) {
    const task = this.get(id);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'interrupted') throw new Error(`Task is not resumable (status: ${task.status}).`);
    this.update(id, { status: 'running', error: null });
    this.addEvent(id, 'resume_started', 'Crash Resume started. Uncertain actions must be re-checked before replay.', { previousStatus: task.status });
    return this.get(id);
  }

  dismissResume(id) {
    const task = this.get(id);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'interrupted') return task;
    this.update(id, { status: 'abandoned', error: task.error });
    this.addEvent(id, 'resume_dismissed', 'Interrupted task was dismissed by the user.');
    return this.get(id);
  }
}

module.exports = { TaskManager };
