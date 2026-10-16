'use strict';
   
                                                                       
                                                                           
                                                              
  
                                                                       
                                                                      
                                                       
   
const fs = require('fs');
const path = require('path');
const { LEVEL } = require('../../permissions/levels');
const { slugify, uniqueSlug } = require('../../utils/slug');
const { textToPdf } = require('../../utils/pdf');
const { textToDocx } = require('../../utils/docx');
const { truncate } = require('../../utils/misc');

const FORMATS = ['md', 'txt', 'pdf', 'docx'];

function stripMd(content) {
  return String(content)
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '• ');
}

function targetDir(ctx) {
  const dir = ctx.workspace ? path.join(ctx.workspace.root_path, 'akhtar-artifacts') : ctx.artifactsDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFormat(dir, slug, title, content, format) {
  if (format === 'pdf') {
    const p = path.join(dir, `${slug}.pdf`);
    fs.writeFileSync(p, textToPdf(title, content));
    return p;
  }
  if (format === 'docx') {
    const p = path.join(dir, `${slug}.docx`);
    fs.writeFileSync(p, textToDocx(title, content));
    return p;
  }
  if (format === 'txt') {
    const p = path.join(dir, `${slug}.txt`);
    fs.writeFileSync(p, `${title}\n${'='.repeat(Math.min(title.length, 70))}\n\n${stripMd(content)}`, 'utf8');
    return p;
  }
  const p = path.join(dir, `${slug}.md`);
  fs.writeFileSync(p, `# ${title}\n\n${content}`, 'utf8');
  return p;
}

function readSource(dir, slug) {
  const srcPath = path.join(dir, `${slug}.md`);
  if (!fs.existsSync(srcPath)) throw new Error(`No saved source for "${slug}". Use document.create again.`);
  const raw = fs.readFileSync(srcPath, 'utf8');
  const titleMatch = raw.match(/^#\s+(.*)$/m);
  const title = titleMatch ? titleMatch[1].trim() : slug;
  const content = titleMatch ? raw.slice(raw.indexOf(titleMatch[0]) + titleMatch[0].length).replace(/^\n+/, '') : raw;
  return { srcPath, title, content };
}

const base = { group: 'documents', permission: LEVEL.WRITE, category: 'documents.write' };

module.exports = [
  {
    ...base, name: 'document.create',
    description: 'Create a document artifact (report/notes/summary) from Markdown content, saved as .md and optionally exported to .txt, .pdf, or .docx (Word).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        content: { type: 'string', maxLength: 200000, description: 'Markdown body (without the title heading).' },
        format: { type: 'string', enum: FORMATS, description: 'Format to also export immediately. Default "md".' },
      },
      required: ['title', 'content'],
    },
    async preview({ title, content, format = 'md' }, ctx) {
      return { title: `Create document "${title}" (.${format})`, summary: truncate(content, 300), path: path.join(ctx.workspace ? 'akhtar-artifacts' : '(app data)', `${slugify(title)}.${format}`) };
    },
    async execute({ title, content, format = 'md' }, ctx) {
      const dir = targetDir(ctx);
      const slug = uniqueSlug(dir, slugify(title), ['.md', '.pdf', '.docx', '.txt']);
      if (format !== 'md') writeFormat(dir, slug, title, content, 'md');                                    
      const outPath = writeFormat(dir, slug, title, content, format);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: `${title}.${format}`, path: outPath, type: 'document' });
      return { artifactId: artifact.id, path: outPath, format, verified: fs.existsSync(outPath) };
    },
  },
  {
    ...base, name: 'document.export',
    description: 'Export an existing document artifact (created via document.create) to another format (md/txt/pdf/docx).',
    inputSchema: {
      type: 'object',
      properties: { artifact_id: { type: 'string' }, format: { type: 'string', enum: FORMATS } },
      required: ['artifact_id', 'format'],
    },
    async preview({ artifact_id, format }, ctx) {
      const a = ctx.artifacts.get(artifact_id);
      if (!a) throw new Error('Artifact not found.');
      return { title: `Export "${a.name}" to .${format}`, summary: a.path };
    },
    async execute({ artifact_id, format }, ctx) {
      const a = ctx.artifacts.get(artifact_id);
      if (!a || a.type !== 'document') throw new Error('Document artifact not found.');
      const dir = path.dirname(a.path);
      const slug = path.basename(a.path, path.extname(a.path));
      const { title, content } = readSource(dir, slug);
      const outPath = writeFormat(dir, slug, title, content, format);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: `${title}.${format}`, path: outPath, type: 'document' });
      return { artifactId: artifact.id, path: outPath, format, verified: fs.existsSync(outPath) };
    },
  },
];
