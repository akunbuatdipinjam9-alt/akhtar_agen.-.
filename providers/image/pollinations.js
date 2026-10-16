'use strict';
   
                                                                       
                                                                       
                                                                        
                                                             
   
const { ImageProvider } = require('./provider');

const DEFAULT_MODEL = 'flux';

function parseSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size || '').trim());
  if (!m) return { width: 1024, height: 1024 };
  return { width: Math.min(2048, +m[1]), height: Math.min(2048, +m[2]) };
}

class PollinationsImageProvider extends ImageProvider {
  get label() { return 'Pollinations'; }
  get requiresKey() { return false; }
  ensureKey() { /* no key needed */ }

  async generate({ prompt, size, model = DEFAULT_MODEL, seed, signal }) {
    if (!prompt || !prompt.trim()) throw new Error('Pollinations: prompt is empty.');
    const { width, height } = parseSize(size);
    const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim())}`);
    url.searchParams.set('width', width);
    url.searchParams.set('height', height);
    if (model) url.searchParams.set('model', model);
    if (seed !== undefined && seed !== null && seed !== '') url.searchParams.set('seed', String(seed));
    url.searchParams.set('nologo', 'true');

    const res = await fetch(url.toString(), { signal });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`Pollinations: HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
    }
    const contentType = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!contentType.startsWith('image/') || buf.length < 500) {
      throw new Error('Pollinations: response did not look like an image (it may have returned an error page instead).');
    }
    return buf;
  }

                                                                                                   
  async getModels(signal) {
    try {
      const res = await fetch('https://image.pollinations.ai/models', { signal });
      if (!res.ok) return [DEFAULT_MODEL];
      const j = await res.json();
      return Array.isArray(j) && j.length ? j : [DEFAULT_MODEL];
    } catch {
      return [DEFAULT_MODEL];
    }
  }
}

module.exports = { PollinationsImageProvider };
