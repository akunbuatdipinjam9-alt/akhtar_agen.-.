'use strict';
   
                                                                   
                                                                         
                                                                        
                                                                   
   
const fs = require('fs');
const path = require('path');
const { LEVEL } = require('../../permissions/levels');
const { slugify, uniqueSlug } = require('../../utils/slug');
const { OpenAIImageProvider } = require('../../providers/image/openai');
const { PollinationsImageProvider } = require('../../providers/image/pollinations');

function targetDir(ctx) {
  const dir = ctx.workspace ? path.join(ctx.workspace.root_path, 'akhtar-artifacts') : ctx.artifactsDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getProvider(providerName, ctx) {
  if (providerName === 'openai') {
    const apiKey = ctx.secrets.get('llm:openai');
    if (!apiKey) throw new Error('No OpenAI API key set. Add one in Settings → Models (OpenAI), or drop provider:"openai" to use Pollinations (free, no key needed).');
    return new OpenAIImageProvider(apiKey);
  }
  return new PollinationsImageProvider();
}

module.exports = [
  {
    name: 'image.generate', group: 'image', permission: LEVEL.NETWORK, category: 'network.image',
    description: 'Generate an image from a text prompt and save it as an artifact. Default provider is Pollinations — free, no API key needed. Pass provider:"openai" to use OpenAI Images instead (needs a key in Settings → Models).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', maxLength: 2000 },
        size: { type: 'string', pattern: '^\\d+x\\d+$', description: 'e.g. "1024x1024". Pollinations accepts any width x height (max 2048); OpenAI only accepts its fixed sizes and will error otherwise.' },
        model: { type: 'string', maxLength: 40, description: 'Pollinations model, e.g. "flux", "flux-realism", "turbo". Ignored for OpenAI.' },
        seed: { type: 'integer', description: 'Pollinations seed for a reproducible result (same prompt+seed+size ≈ same image). Ignored for OpenAI.' },
        provider: { type: 'string', enum: ['pollinations', 'openai'], description: 'Default "pollinations".' },
        name: { type: 'string', maxLength: 150, description: 'Short filename hint; defaults to the prompt.' },
      },
      required: ['prompt'],
    },
    async preview({ prompt, provider = 'pollinations' }) { return { title: `Generate image (${provider})`, summary: prompt }; },
    async execute({ prompt, size = '1024x1024', model, seed, provider = 'pollinations', name }, ctx) {
      const providerInstance = getProvider(provider, ctx);
      const buffer = await providerInstance.generate({ prompt, size, model, seed, signal: ctx.signal });
      const dir = targetDir(ctx);
      const slug = uniqueSlug(dir, slugify(name || prompt.slice(0, 60)), ['.png']);
      const filePath = path.join(dir, `${slug}.png`);
      fs.writeFileSync(filePath, buffer);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: `${slug}.png`, path: filePath, type: 'image' });
      return { artifactId: artifact.id, path: filePath, provider, bytes: buffer.length, verified: fs.existsSync(filePath) };
    },
  },
];
