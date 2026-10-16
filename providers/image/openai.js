'use strict';
const { ImageProvider } = require('./provider');

class OpenAIImageProvider extends ImageProvider {
  get label() { return 'OpenAI Images'; }

  async generate({ prompt, size = '1024x1024', signal }) {
    this.ensureKey();
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
      signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
      throw new Error(`OpenAI Images: ${msg}`);
    }
    const j = await res.json();
    const item = j.data?.[0];
    if (!item) throw new Error('OpenAI Images: no image returned.');
    if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item.url) {
      const r2 = await fetch(item.url, { signal });
      if (!r2.ok) throw new Error(`OpenAI Images: could not download generated image (HTTP ${r2.status}).`);
      return Buffer.from(await r2.arrayBuffer());
    }
    throw new Error('OpenAI Images: response had neither b64_json nor url.');
  }
}

module.exports = { OpenAIImageProvider };
