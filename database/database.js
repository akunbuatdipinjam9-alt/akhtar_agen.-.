'use strict';
   
                                                                      
                                                                          
                                                    
   
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { logger } = require('../utils/logger');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT, meta TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, mode TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT, tool_calls TEXT, tool_call_id TEXT, tool_name TEXT, meta TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, workspace_id TEXT, root_path TEXT, index_json TEXT, indexed_at INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, conversation_id TEXT, workspace_id TEXT, title TEXT,
  status TEXT, mode TEXT, error TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id);
CREATE TABLE IF NOT EXISTS todos (
  task_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT, status TEXT, priority TEXT,
  note TEXT, position INTEGER, created_at INTEGER, updated_at INTEGER,
  PRIMARY KEY (task_id, id)
);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, type TEXT, message TEXT,
  data TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY, task_id TEXT, conversation_id TEXT, name TEXT, args TEXT,
  result TEXT, status TEXT, started_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, workspace_id TEXT, path TEXT, meta TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, workspace_id TEXT, task_id TEXT, name TEXT, path TEXT,
  type TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY, workspace_id TEXT, data TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS permissions (
  workspace_id TEXT NOT NULL, category TEXT NOT NULL, decision TEXT NOT NULL,
  created_at INTEGER, PRIMARY KEY (workspace_id, category)
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, scope TEXT, workspace_id TEXT, content TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY, workspace_id TEXT, task_id TEXT, label TEXT,
  created_at INTEGER, restored_at INTEGER
);
CREATE TABLE IF NOT EXISTS checkpoint_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, checkpoint_id TEXT, action TEXT, path TEXT,
  before TEXT, extra TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, workspace_id TEXT, conversation_id TEXT, title TEXT NOT NULL, instruction TEXT NOT NULL,
  recurrence TEXT NOT NULL, run_at INTEGER, day_of_week TEXT, day_of_month INTEGER, time TEXT,
  timezone TEXT, mode TEXT, enabled INTEGER DEFAULT 1, next_run_at INTEGER,
  last_run_at INTEGER, last_status TEXT, last_error TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(enabled, next_run_at);
`;

function normParams(params) {
  if (!params) return [];
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

class Database {
  constructor() {
    this.db = null;
    this.file = null;
    this.saveTimer = null;
    this.dirty = false;
    this.inTx = false;
  }

  async init(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const SQL = await initSqlJs();
    let buf = null;
    if (fs.existsSync(file)) {
      try { buf = fs.readFileSync(file); } catch (e) { logger.error('Cannot read DB file', e); }
    }
    try {
      this.db = buf ? new SQL.Database(buf) : new SQL.Database();
                                                                                              
                                                                                  
      if (buf) this.db.exec('PRAGMA schema_version; SELECT count(*) FROM sqlite_master;');
      this.db.exec(SCHEMA);
    } catch (e) {
      logger.error('DB corrupted, starting fresh (backup kept)', e);
      try { this.db?.close(); } catch { /* ignore */ }
      try { fs.copyFileSync(file, file + `.corrupt-${Date.now()}`); } catch (copyErr) { logger.error('Could not back up corrupt DB', copyErr); }
      this.db = new SQL.Database();
      this.db.exec(SCHEMA);
    }
    this.db.run("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')");
    this.saveNow();
  }

  run(sql, params) {
    this.db.run(sql, normParams(params));
    this._scheduleSave();
  }

  get(sql, params) {
    const st = this.db.prepare(sql);
    try {
      st.bind(normParams(params));
      return st.step() ? st.getAsObject() : undefined;
    } finally { st.free(); }
  }

  all(sql, params) {
    const st = this.db.prepare(sql);
    const rows = [];
    try {
      st.bind(normParams(params));
      while (st.step()) rows.push(st.getAsObject());
    } finally { st.free(); }
    return rows;
  }

  transaction(fn) {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.inTx = false;
      this._scheduleSave();
    }
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, 400);
  }

  saveNow() {
    if (!this.db || !this.file) return;
    try {
      const data = Buffer.from(this.db.export());
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      logger.error('Failed to save database', e);
    }
  }
}

module.exports = { Database };
