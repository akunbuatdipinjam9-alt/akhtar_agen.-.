'use strict';
                                                                                     
const { LEVEL } = require('../../permissions/levels');

const base = { group: 'skill', permission: LEVEL.NONE, category: 'none' };

module.exports = [
  {
    ...base, name: 'skill.list',
    description: 'List available skills (specialised instructions) with their descriptions.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) { return { skills: ctx.skills.list().map(({ name, description }) => ({ name, description })) }; },
  },
  {
    ...base, name: 'skill.load',
    description: 'Load a skill\'s full instructions by name before doing that kind of work.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async execute({ name }, ctx) {
      const s = ctx.skills.get(name);
      if (!s) throw new Error(`Skill "${name}" not found. Call skill.list to see options.`);
      return { name: s.name, instructions: s.body };
    },
  },
  {
    ...base, name: 'tools.available',
    description: 'Inspect tools actually registered and allowed in this mode, with required parameters and permission levels. This is live registry data, not SKILL.md documentation.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const available = ctx.registry.forMode(ctx.mode, { hasWorkspace: !!ctx.workspace });
      return {
        mode: ctx.mode,
        workspace_open: !!ctx.workspace,
        count: available.length,
        tools: available.map(t => ({
          name: t.name,
          description: t.description,
          required: t.inputSchema?.required || [],
          permission: typeof t.permission === 'string' ? t.permission : 'dynamic',
        })),
        note: 'Available means registered and allowed; success of external services requires actually running a tool.',
      };
    },
  },
];
