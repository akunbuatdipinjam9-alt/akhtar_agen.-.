'use strict';
   
                                                                           
                                                                          
                                                                          
                                                                        
                         
  
                                                                           
                                                                         
   
const fs = require('fs');
const path = require('path');
const { LEVEL } = require('../../permissions/levels');
const { slugify, uniqueSlug } = require('../../utils/slug');
const { slidesToPptx } = require('../../utils/pptx');

const FORMATS = ['md', 'html', 'pptx'];

function targetDir(ctx) {
  const dir = ctx.workspace ? path.join(ctx.workspace.root_path, 'akhtar-artifacts') : ctx.artifactsDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildMd(title, slides) {
  const parts = [`# ${title}`];
  for (const s of slides) {
    const bulletsBlock = (s.bullets || []).map((b) => `- ${b}`).join('\n');
    parts.push(['---', `## ${s.title}`, bulletsBlock].filter(Boolean).join('\n\n'));
  }
  return parts.join('\n\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildHtml(title, slides) {
  const slideHtml = slides.map((s, i) => `
  <section class="slide" data-index="${i}">
    <h2>${esc(s.title)}</h2>
    <ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  </section>`).join('\n');
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #0b0d10; color: #e8eaed; height: 100vh; overflow: hidden; }
  .deck { height: 100vh; display: flex; align-items: center; justify-content: center; }
  .slide { display: none; width: min(900px, 88vw); padding: 40px; }
  .slide.active { display: block; }
  .slide h2 { font-size: 2.4em; margin: 0 0 .6em; border-bottom: 2px solid #5b8cff; padding-bottom: .3em; }
  .slide ul { font-size: 1.35em; line-height: 1.7; }
  .bar { position: fixed; bottom: 18px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 14px; color: #9aa4b2; font-size: 13px; }
  .bar button { background: #181c22; border: 1px solid #262b33; color: #e8eaed; border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
  .bar button:hover { background: #1f242c; }
  .title-slide h1 { font-size: 3em; }
</style>
</head>
<body>
  <div class="deck">
    <section class="slide active title-slide"><h1>${esc(title)}</h1></section>
    ${slideHtml}
  </div>
  <div class="bar">
    <button id="prev">&larr;</button>
    <span id="pos"></span>
    <button id="next">&rarr;</button>
  </div>
  <script>
    const slides = Array.from(document.querySelectorAll('.slide'));
    let i = 0;
    function show(n) {
      i = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
      document.getElementById('pos').textContent = (i + 1) + ' / ' + slides.length;
    }
    document.getElementById('next').onclick = () => show(i + 1);
    document.getElementById('prev').onclick = () => show(i - 1);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') show(i + 1);
      else if (e.key === 'ArrowLeft') show(i - 1);
    });
    show(0);
  </script>
</body>
</html>`;
}

function writeFormat(dir, slug, title, slides, format) {
  if (format === 'pptx') {
    const p = path.join(dir, `${slug}.pptx`);
    fs.writeFileSync(p, slidesToPptx(title, slides));
    return p;
  }
  if (format === 'html') {
    const p = path.join(dir, `${slug}.html`);
    fs.writeFileSync(p, buildHtml(title, slides), 'utf8');
    return p;
  }
  const p = path.join(dir, `${slug}.md`);
  fs.writeFileSync(p, buildMd(title, slides), 'utf8');
  return p;
}

const slideSchema = {
  type: 'object',
  properties: { title: { type: 'string', maxLength: 150 }, bullets: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 } } },
  required: ['title'],
};

const base = { group: 'presentations', permission: LEVEL.WRITE, category: 'presentations.write' };

module.exports = [
  {
    ...base, name: 'presentation.create',
    description: 'Create a slide deck artifact from a title + list of slides (each with a title and bullet points). Saves a Markdown outline, a standalone HTML deck, or a real PowerPoint (.pptx).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        slides: { type: 'array', maxItems: 60, items: slideSchema },
        format: { type: 'string', enum: FORMATS, description: 'Default "html" (presentable deck). Use "pptx" for real PowerPoint, "md" for a plain outline.' },
      },
      required: ['title', 'slides'],
    },
    async preview({ title, slides, format = 'html' }, ctx) {
      return { title: `Create presentation "${title}" (${slides.length} slides, .${format})`, summary: slides.map((s) => `• ${s.title}`).join('\n') };
    },
    async execute({ title, slides, format = 'html' }, ctx) {
      const dir = targetDir(ctx);
      const slug = uniqueSlug(dir, slugify(title), ['.slides.json', '.md', '.html', '.pptx']);
      fs.writeFileSync(path.join(dir, `${slug}.slides.json`), JSON.stringify({ title, slides }), 'utf8');
      const outPath = writeFormat(dir, slug, title, slides, format);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: `${title}.${format}`, path: outPath, type: 'presentation' });
      return { artifactId: artifact.id, path: outPath, format, slide_count: slides.length, verified: fs.existsSync(outPath) };
    },
  },
  {
    ...base, name: 'presentation.export',
    description: 'Export an existing presentation artifact to another format (md/html/pptx).',
    inputSchema: { type: 'object', properties: { artifact_id: { type: 'string' }, format: { type: 'string', enum: FORMATS } }, required: ['artifact_id', 'format'] },
    async preview({ artifact_id, format }, ctx) {
      const a = ctx.artifacts.get(artifact_id);
      if (!a) throw new Error('Artifact not found.');
      return { title: `Export "${a.name}" to .${format}`, summary: a.path };
    },
    async execute({ artifact_id, format }, ctx) {
      const a = ctx.artifacts.get(artifact_id);
      if (!a || a.type !== 'presentation') throw new Error('Presentation artifact not found.');
      const dir = path.dirname(a.path);
      const slug = path.basename(a.path).split('.')[0];
      const jsonPath = path.join(dir, `${slug}.slides.json`);
      if (!fs.existsSync(jsonPath)) throw new Error('No saved slide source; use presentation.create again.');
      const { title, slides } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const outPath = writeFormat(dir, slug, title, slides, format);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: `${title}.${format}`, path: outPath, type: 'presentation' });
      return { artifactId: artifact.id, path: outPath, format, verified: fs.existsSync(outPath) };
    },
  },
];
