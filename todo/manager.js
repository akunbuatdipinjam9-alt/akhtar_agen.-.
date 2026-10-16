'use strict';
                                                                                               
const { uid, now } = require('../utils/misc');

const STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'blocked', 'cancelled'];

class TodoManager {
  constructor(db) { this.db = db; }

  list(taskId) {
    return this.db.all('SELECT * FROM todos WHERE task_id = ? ORDER BY position ASC', [taskId]);
  }

  create(taskId, items) {
    this.db.transaction(() => {
      this.db.run('DELETE FROM todos WHERE task_id = ?', [taskId]);
      (items || []).forEach((it, i) => {
        const t = now();
        this.db.run(
          'INSERT INTO todos (task_id, id, title, status, priority, note, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [taskId, uid(), String(it.title).slice(0, 200), 'pending', it.priority || 'normal', null, i, t, t],
        );
      });
    });
    return this.list(taskId);
  }

  add(taskId, { title, priority = 'normal' }) {
    const pos = this.db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM todos WHERE task_id = ?', [taskId]).p;
    const t = now();
    const id = uid();
    this.db.run(
      'INSERT INTO todos (task_id, id, title, status, priority, note, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [taskId, id, String(title).slice(0, 200), 'pending', priority, null, pos, t, t],
    );
    return id;
  }

  update(taskId, id, { status, title, note }) {
    const row = this.db.get('SELECT * FROM todos WHERE task_id = ? AND id = ?', [taskId, id]);
    if (!row) throw new Error(`Todo "${id}" not found.`);
    if (status && !STATUSES.includes(status)) throw new Error(`Invalid status "${status}".`);
    this.db.run(
      'UPDATE todos SET status = ?, title = ?, note = ?, updated_at = ? WHERE task_id = ? AND id = ?',
      [status ?? row.status, title ?? row.title, note ?? row.note, now(), taskId, id],
    );
  }

  remove(taskId, id) {
    this.db.run('DELETE FROM todos WHERE task_id = ? AND id = ?', [taskId, id]);
  }

                                                                                                 
  isDone(taskId) {
    const rows = this.list(taskId);
    return rows.length > 0 && rows.every((r) => ['completed', 'failed', 'cancelled'].includes(r.status));
  }
}

module.exports = { TodoManager, STATUSES };
