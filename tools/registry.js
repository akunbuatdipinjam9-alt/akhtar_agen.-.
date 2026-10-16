'use strict';
   
                                                        
  
              
    
                                                 
                         
                        
                                                           
                                              
                                                                             
                                
                                                                       
                                                                                            
                                         
    
                                                        
   
const CHAT_GROUPS = new Set(['time', 'weather', 'prayer', 'hadith', 'moon', 'qibla', 'islamic_events', 'skill', 'travel', 'lab', 'preview']);

class ToolRegistry {
  constructor() { this.tools = new Map(); }

  register(tool) {
    for (const k of ['name', 'description', 'inputSchema', 'permission', 'execute']) {
      if (!tool[k]) throw new Error(`Tool is missing "${k}": ${tool.name || '(unnamed)'}`);
    }
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(tool.name)) throw new Error(`Invalid tool name ${tool.name}`);
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  registerAll(list) { list.forEach((t) => this.register(t)); }

  get(name) { return this.tools.get(name) || null; }

  all() { return [...this.tools.values()]; }

                                                                                              
  forMode(mode, { hasWorkspace }) {
    return this.all().filter((t) => {
      if (t.requiresWorkspace && !hasWorkspace) return false;
      if (t.modes) return t.modes.includes(mode);
      if (mode === 'chat') return CHAT_GROUPS.has(t.group) || t.name === 'memory.list';
      return true;
    });
  }

                                                                                    
                                                                                   
                                                             
  static toSchemas(tools) {
    return tools.map((t) => {
      const meta = t.toolIntelligence || {};
      const hints = [];
      if (meta.capabilities?.length) hints.push(`Capabilities: ${meta.capabilities.join(', ')}`);
      if (meta.risk) hints.push(`Risk: ${meta.risk}`);
      if (meta.sideEffects === false) hints.push('Read-only/no side effects');
      if (meta.preferredBefore?.length) hints.push(`Prefer before: ${meta.preferredBefore.join(', ')}`);
      if (meta.verification?.length) hints.push(`Verify with: ${meta.verification.join(', ')}`);
      return {
        name: t.name,
        description: hints.length ? `${t.description}\nTool guidance: ${hints.join('; ')}.` : t.description,
        inputSchema: t.inputSchema,
      };
    });
  }
}

module.exports = { ToolRegistry };
