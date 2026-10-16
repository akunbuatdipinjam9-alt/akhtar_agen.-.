'use strict';
                                                          
const { LEVEL } = require('../../permissions/levels');

const STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'blocked', 'cancelled'];
const base = { group: 'todo', permission: LEVEL.NONE, category: 'none', modes: ['assist', 'agent'] };

function need(ctx) {
  if (!ctx.taskId) throw new Error('No active task.');
  return ctx.todo;
}
const listResult = (ctx) => ({ todos: ctx.todo.list(ctx.taskId) });

module.exports = [
  {
    ...base, name: 'todo.create',
    description: 'Create (or replace) the todo list for the current task. Use for complex, multi-step work; skip for simple questions.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array', maxItems: 30,
          items: { type: 'object', properties: { title: { type: 'string', maxLength: 200 }, priority: { type: 'string', enum: ['low', 'normal', 'high'] } }, required: ['title'] },
        },
      },
      required: ['items'],
    },
    async execute({ items }, ctx) { need(ctx).create(ctx.taskId, items); return listResult(ctx); },
  },
  {
    ...base, name: 'todo.add',
    description: 'Add a todo item discovered during work.',
    inputSchema: { type: 'object', properties: { title: { type: 'string', maxLength: 200 }, priority: { type: 'string', enum: ['low', 'normal', 'high'] } }, required: ['title'] },
    async execute(args, ctx) { need(ctx).add(ctx.taskId, args); return listResult(ctx); },
  },
  {
    ...base, name: 'todo.update',
    description: 'Update a todo\'s status or title. Set status "in_progress" when you start an item.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUSES }, title: { type: 'string', maxLength: 200 }, note: { type: 'string', maxLength: 500 } },
      required: ['id'],
    },
    async execute({ id, ...fields }, ctx) { need(ctx).update(ctx.taskId, id, fields); return listResult(ctx); },
  },
  {
    ...base, name: 'todo.complete',
    description: 'Mark a todo as completed. Only do this after the work is verified.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string', maxLength: 500 } }, required: ['id'] },
    async execute({ id, note }, ctx) { need(ctx).update(ctx.taskId, id, { status: 'completed', note }); return listResult(ctx); },
  },
  {
    ...base, name: 'todo.fail',
    description: 'Mark a todo as failed with a reason.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string', maxLength: 500 } }, required: ['id', 'reason'] },
    async execute({ id, reason }, ctx) { need(ctx).update(ctx.taskId, id, { status: 'failed', note: reason }); return listResult(ctx); },
  },
  {
    ...base, name: 'todo.remove',
    description: 'Remove a todo item that is no longer needed.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async execute({ id }, ctx) { need(ctx).remove(ctx.taskId, id); return listResult(ctx); },
  },
  {
    ...base, name: 'todo.list',
    description: 'List the current task\'s todos and their statuses.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, ctx) { need(ctx); return listResult(ctx); },
  },
];
