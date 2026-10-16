'use strict';
                                                                                            
const { LEVEL } = require('../../permissions/levels');

const base = { group: 'schedule', permission: LEVEL.NONE, category: 'none', modes: ['assist', 'agent'] };

function publicView(s) {
  return {
    id: s.id, title: s.title, instruction: s.instruction, recurrence: s.recurrence,
    run_at: s.run_at ? new Date(s.run_at).toISOString() : null,
    day_of_week: s.day_of_week, day_of_month: s.day_of_month, time: s.time, timezone: s.timezone,
    mode: s.mode, enabled: s.enabled,
    next_run_at: s.next_run_at ? new Date(s.next_run_at).toISOString() : null,
    last_run_at: s.last_run_at ? new Date(s.last_run_at).toISOString() : null,
    last_status: s.last_status, last_error: s.last_error,
  };
}

module.exports = [
  {
    ...base, name: 'schedule.create',
    description: 'Schedule a task to run automatically later — once at a specific time, or recurring daily/weekly/monthly. When it fires, the agent runs "instruction" unattended, same as if the user had just typed it — but nobody is watching, so any action needing a live permission dialog will be skipped unless already pre-approved ("Allow for Project").',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200, description: 'Short label, e.g. "Cek harga BTC".' },
        instruction: { type: 'string', maxLength: 4000, description: 'What to do when this fires, written as the user would type it, e.g. "Cek harga BTC dan ringkas perubahannya."' },
        recurrence: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly'] },
        run_at: { type: 'string', description: 'ISO datetime — required (and only used) for recurrence "once", e.g. "2026-09-27T07:00:00".' },
        time: { type: 'string', description: '"HH:MM", 24-hour — required for daily/weekly/monthly.' },
        day_of_week: { type: 'string', enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], description: 'Required for weekly.' },
        day_of_month: { type: 'integer', minimum: 1, maximum: 31, description: 'Required for monthly. Clamped to the last day of shorter months (e.g. 31 in April → 30).' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. "Asia/Jakarta". Defaults to the system timezone.' },
        mode: { type: 'string', enum: ['chat', 'assist', 'agent'], description: 'Default "agent" (most useful unattended — assist would just get stuck waiting on permission dialogs).' },
      },
      required: ['title', 'instruction', 'recurrence'],
    },
    async preview(args) {
      const when = args.recurrence === 'once' ? args.run_at : `${args.recurrence} at ${args.time}${args.day_of_week ? ` on ${args.day_of_week}` : ''}${args.day_of_month ? ` on day ${args.day_of_month}` : ''}`;
      return { title: `Schedule "${args.title}"`, summary: `${when}\n\n${args.instruction}` };
    },
    async execute(args, ctx) {
      const s = ctx.scheduler.create({ workspaceId: ctx.workspaceId, ...args });
      return publicView(s);
    },
  },
  {
    ...base, name: 'schedule.list',
    description: 'List scheduled tasks for the current workspace.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) { return { schedules: ctx.scheduler.list(ctx.workspaceId).map(publicView) }; },
  },
  {
    ...base, name: 'schedule.cancel',
    description: 'Cancel and permanently delete a scheduled task.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async execute({ id }, ctx) { ctx.scheduler.remove(id); return { cancelled: true }; },
  },
  {
    ...base, name: 'schedule.pause',
    description: 'Pause a scheduled task without deleting it (its next run is skipped until resumed).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async execute({ id }, ctx) { return publicView(ctx.scheduler.setEnabled(id, false)); },
  },
  {
    ...base, name: 'schedule.resume',
    description: 'Resume a paused scheduled task.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async execute({ id }, ctx) { return publicView(ctx.scheduler.setEnabled(id, true)); },
  },
];
