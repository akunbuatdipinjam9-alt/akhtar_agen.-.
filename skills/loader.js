'use strict';
   
                                                  
  
                                                            
  
            
                                                
  
                                                                                 
  
                                                                          
   
const fs = require('fs');
const path = require('path');

function parseSkillMd(raw, fallbackName) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let title = fallbackName;
  let description = '';
  let i = 0;
  if (lines[0]?.startsWith('# ')) { title = lines[0].slice(2).trim(); i = 1; }
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i]?.startsWith('>')) { description = lines[i].slice(1).trim(); i++; }
  return { title, description, body: raw };
}

class SkillLoader {
  constructor(dirs) {
                                                                                                        
    this.dirs = Array.isArray(dirs) ? dirs : [dirs];
    this.cache = null;
  }

  reload() {
    const byName = new Map();
    for (const dir of this.dirs) {
      if (!dir || !fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const parsed = parseSkillMd(raw, entry.name);
          byName.set(entry.name, { name: entry.name, ...parsed });
        } catch { /* skip unreadable skill */ }
      }
    }
    this.cache = byName;
    return this;
  }

  list() {
    if (!this.cache) this.reload();
    return [...this.cache.values()].map(({ name, title, description }) => ({ name, title, description }));
  }

  get(name) {
    if (!this.cache) this.reload();
    return this.cache.get(name) || null;
  }
}

module.exports = { SkillLoader };
