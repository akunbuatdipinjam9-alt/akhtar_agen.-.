'use strict';
                                                                                                   
const { ToolRegistry } = require('./registry');

const GROUPS = [
  require('./filesystem'),
  require('./terminal'),
  require('./code'),
  require('./browser'),
  require('./weather'),
  require('./travel'),
  require('./lab'),
  require('./preview'),
  require('./time'),
  require('./prayer'),
  require('./hadith'),
  require('./moon'),
  require('./qibla'),
  require('./islamic-events'),
  require('./skill'),
  require('./todo'),
  require('./memory'),
  require('./documents'),
  require('./presentations'),
  require('./map'),
  require('./image'),
  require('./chart'),
  require('./computer'),
  require('./wallpaper'),
  require('./system-controls'),
  require('./network-controls'),
  require('./schedule'),
  require('./git'),
  require('./github'),
  require('./mcp'),
  require('./ai'),
];

function buildRegistry() {
  const registry = new ToolRegistry();
  for (const group of GROUPS) registry.registerAll(group);
  return registry;
}

module.exports = { buildRegistry };
