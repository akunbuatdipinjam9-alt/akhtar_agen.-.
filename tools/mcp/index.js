'use strict';
const { LEVEL } = require('../../permissions/levels');
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

module.exports = [
  {
    name: 'mcp.servers', group: 'mcp', description: 'List configured MCP servers.',
    inputSchema: obj(), permission: LEVEL.READ,
    execute: async (_args, ctx) => ({ servers: ctx.mcp.listServers() }),
  },
  {
    name: 'mcp.tools', group: 'mcp', description: 'Discover tools exposed by one configured MCP server.',
    inputSchema: obj({ server_id: { type: 'string' } }, ['server_id']), permission: LEVEL.NETWORK, category: 'mcp.discovery',
    execute: async (args, ctx) => ({ server_id: args.server_id, tools: await ctx.mcp.listTools(args.server_id, ctx.signal) }),
  },
  {
    name: 'mcp.call', group: 'mcp', description: 'Call a tool on a configured MCP server. Discover it with mcp.tools first. External MCP tools are treated as sensitive because their side effects are server-defined.',
    inputSchema: obj({ server_id: { type: 'string' }, tool: { type: 'string' }, arguments: { type: 'object' } }, ['server_id', 'tool']),
    permission: LEVEL.SENSITIVE, category: 'mcp.call',
    preview: async (args) => ({ title: `MCP: ${args.server_id} → ${args.tool}`, summary: 'Run an external MCP tool.', warning: 'MCP tools may access external services. Only approve servers you trust.' }),
    execute: async (args, ctx) => ctx.mcp.callTool(args.server_id, args.tool, args.arguments || {}, ctx.signal),
  },
];
