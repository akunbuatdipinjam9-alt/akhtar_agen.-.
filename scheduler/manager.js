'use strict';
   
                                                                    
                                                                        
                                                                      
                                                                       
                                                                           
                                                                      
                                                 
   
const { uid, now } = require('../utils/misc');
const { computeNextRun } = require('./recurrence');
const { logger } = require('../utils/logger');

const VALID_RECURRENCE = ['once', 'daily', 'weekly', 'monthly'];

function mapRow(r) {
  if (!r) return null;
  return { ...r, enabled: !!r.enabled };
}

class SchedulerManager {
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.timer = null;
    this.running = new Set();
    this.controllers = new Map();                                                      
  }

  create({ workspaceId = null, title, instruction, recurrence, run_at, day_of_week, day_of_month, time, timezone, mode = 'agent' }) {
    if (!title || !title.trim()) throw new Error('title is required.');
    if (!instruction || !instruction.trim()) throw new Error('instruction is required.');
    if (!VALID_RECURRENCE.includes(recurrence)) throw new Error(`Invalid recurrence "${recurrence}" (use once/daily/weekly/monthly).`);
    if (recurrence === 'once' && !run_at) throw new Error('recurrence "once" needs run_at (ISO datetime).');
    if (recurrence !== 'once' && !time) throw new Error(`recurrence "${recurrence}" needs "time" ("HH:MM").`);
    if (recurrence === 'weekly' && !day_of_week) throw new Error('recurrence "weekly" needs day_of_week.');
    if (recurrence === 'monthly' && !day_of_month) throw new Error('recurrence "monthly" needs day_of_month (1-31).');
    if (!['chat', 'assist', 'agent'].includes(mode)) mode = 'agent';

    let runAtMs = null;
    if (run_at) {
      runAtMs = new Date(run_at).getTime();
      if (Number.isNaN(runAtMs)) throw new Error(`Invalid run_at "${run_at}".`);
    }

    const row = { recurrence, run_at: runAtMs, day_of_week: day_of_week || null, day_of_month: day_of_month || null, time: time || null, timezone: timezone || null };
    const t = now();
    const nextRun = computeNextRun(row, new Date(t));

    const id = uid();
    this.db.run(
      `INSERT INTO schedules (id, workspace_id, conversation_id, title, instruction, recurrence, run_at, day_of_week, day_of_month, time, timezone, mode, enabled, next_run_at, last_run_at, last_status, last_error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, workspaceId, null, title.trim().slice(0, 200), instruction.trim().slice(0, 4000), recurrence, runAtMs,
        row.day_of_week, row.day_of_month, row.time, row.timezone, mode, 1, nextRun.getTime(), null, null, null, t, t],
    );
    return this.get(id);
  }

  get(id) { return mapRow(this.db.get('SELECT * FROM schedules WHERE id = ?', [id])); }

  list(workspaceId) {
    const rows = workspaceId
      ? this.db.all('SELECT * FROM schedules WHERE workspace_id = ? ORDER BY next_run_at ASC', [workspaceId])
      : this.db.all('SELECT * FROM schedules ORDER BY next_run_at ASC');
    return rows.map(mapRow);
  }

  setEnabled(id, enabled) {
    if (!this.get(id)) throw new Error('Schedule not found.');
    this.db.run('UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, now(), id]);
    return this.get(id);
  }

  remove(id) { this.db.run('DELETE FROM schedules WHERE id = ?', [id]); }

  start(intervalMs = 30000) {
    if (this.timer) return;
                                                                        
    try { this.db.run("UPDATE schedules SET last_status = 'interrupted', last_error = 'App exited during this scheduled run.' WHERE last_status = 'running'"); }
    catch (e) { logger.error('scheduler recovery failed', e); }
    this.timer = setInterval(() => { this.tick().catch((e) => logger.error('scheduler tick failed', e)); }, intervalMs);
    this.tick().catch((e) => logger.error('scheduler tick failed', e));
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
                                                                                           
    for (const ctrl of this.controllers.values()) { try { ctrl.abort(); } catch { /* ignore */ } }
  }

  async tick() {
    const due = this.db.all('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ?', [now()]).map(mapRow);
    for (const s of due) {
      if (this.running.has(s.id)) continue;
                                                                                               
      if (s.conversation_id && this.app.activeRuns?.has(s.conversation_id)) continue;
      this.running.add(s.id);
      this._runOne(s)
        .catch((e) => logger.error(`Scheduler run ${s.id} crashed`, e))
        .finally(() => this.running.delete(s.id));
    }
  }

     
                                                                                        
                                                                                        
                                                                                              
     
  _claimSlot(schedule) {
    const t = now();
    if (schedule.recurrence === 'once') {
      this.db.run('UPDATE schedules SET enabled = 0, last_run_at = ?, last_status = ?, last_error = NULL, updated_at = ? WHERE id = ?', [t, 'running', t, schedule.id]);
      return true;
    }
    let next;
    try { next = computeNextRun(schedule, new Date(t + 1000)); }                                                   
    catch (e) {
      logger.error(`Could not compute next run for schedule ${schedule.id}`, e);
      this.db.run('UPDATE schedules SET enabled = 0, last_status = ?, last_error = ?, updated_at = ? WHERE id = ?', ['failed', `Invalid schedule: ${e.message}`, t, schedule.id]);
      return false;
    }
    this.db.run('UPDATE schedules SET next_run_at = ?, last_run_at = ?, last_status = ?, last_error = NULL, updated_at = ? WHERE id = ?', [next.getTime(), t, 'running', t, schedule.id]);
    return true;
  }

  async _runOne(schedule) {
    const app = this.app;
    if (!this._claimSlot(schedule)) return;
    let status = 'success';
    let error = null;
    let conversationId = schedule.conversation_id;
    const ctrl = new AbortController();
    this.controllers.set(schedule.id, ctrl);
    try {
      if (!conversationId || !app.repos.getConversation?.(conversationId)) {
        const conv = app.repos.createConversation({ workspaceId: schedule.workspace_id, mode: schedule.mode, title: `⏰ ${schedule.title}` });
        conversationId = conv.id;
        this.db.run('UPDATE schedules SET conversation_id = ? WHERE id = ?', [conversationId, schedule.id]);
      }
      if (app.activeRuns?.has(conversationId)) throw new Error('Another run is already active in this conversation.');
      app.activeRuns?.set(conversationId, { ctrl, takeover: { request: () => ({ requested: false }), resume: () => ({ resumed: false }), cancel() {}, state: () => ({}) } });
      const result = await app.agent.run({
        conversationId, workspaceId: schedule.workspace_id, mode: schedule.mode || 'agent',
        text: schedule.instruction, signal: ctrl.signal, unattended: true,
                                                                                           
                                                                               
        onEvent: (ev) => { const w = app.getWindow?.(); if (w && !w.isDestroyed()) w.webContents.send('schedule:event', { scheduleId: schedule.id, conversationId, ...ev }); },
      });
      const taskStatus = result?.task?.status;
      if (taskStatus && taskStatus !== 'completed') { status = taskStatus === 'timeout' ? 'timeout' : 'stopped'; }
    } catch (e) {
      status = 'failed';
      error = e.message;
      logger.agent('error', `Scheduled task "${schedule.title}" failed`, { error: e.message });
    } finally {
      this.controllers.delete(schedule.id);
      if (conversationId && app.activeRuns?.get(conversationId)?.ctrl === ctrl) app.activeRuns.delete(conversationId);
    }
    const t = now();
    this.db.run('UPDATE schedules SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?', [status, error, t, schedule.id]);
  }
}

module.exports = { SchedulerManager };
