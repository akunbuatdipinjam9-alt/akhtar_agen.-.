'use strict';
                                                                                            
const { LEVEL } = require('../../permissions/levels');

module.exports = [
  {
    name: 'memory.list', group: 'memory', permission: LEVEL.NONE, category: 'none',
    description: 'List user-approved memories (global and for the current project).',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) { return { memories: ctx.memory.list(ctx.workspaceId).map(({ id, scope, content }) => ({ id, scope, content })) }; },
  },
  {
    name: 'memory.save', group: 'memory', permission: LEVEL.SENSITIVE, category: 'memory.write', modes: ['assist', 'agent'],
    description: 'Propose saving a durable fact (project conventions, user preferences). The user must approve. Never store credentials.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', maxLength: 500 }, scope: { type: 'string', enum: ['project', 'global'] } },
      required: ['content'],
    },
    async preview({ content, scope = 'project' }, ctx) {
      ctx.memory.assertStorable(content);
      if (scope === 'project' && !ctx.workspaceId) scope = 'global';
      return { title: `Save ${scope} memory`, summary: content };
    },
    async execute({ content, scope = 'project' }, ctx) {
      const m = ctx.memory.add({ scope: scope === 'project' && ctx.workspaceId ? 'project' : 'global', workspaceId: ctx.workspaceId, content });
      return { saved: true, id: m.id, scope: m.scope };
    },
  },
];
