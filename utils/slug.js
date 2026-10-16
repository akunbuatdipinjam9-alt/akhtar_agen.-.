'use strict';
const fs = require('fs');
const path = require('path');

function slugify(s, fallback = 'untitled') {
  const slug = String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')                                           
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

   
                                                                                             
                                                                                    
                                                          
   
function uniqueSlug(dir, base, exts) {
  const taken = (slug) => exts.some((ext) => fs.existsSync(path.join(dir, `${slug}${ext}`)));
  if (!taken(base)) return base;
  for (let i = 2; i < 10000; i++) { const s = `${base}-${i}`; if (!taken(s)) return s; }
  return `${base}-${Date.now()}`;
}

module.exports = { slugify, uniqueSlug };
