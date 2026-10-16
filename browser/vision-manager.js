
'use strict';
                                                                                    
                                                                                                 
   
const { nativeImage } = require('electron');
const { createProvider } = require('../providers/llm');

class BrowserVisionManager {
  constructor(app) { this.app = app; this.usage = new Map(); }
  status(taskId) {
    const max = this.app.settings.get().browserVision?.maxCallsPerTask || 3;
    const used = this.usage.get(taskId) || 0;
    return { used, max, remaining: Math.max(0, max-used) };
  }
  clear(taskId) { this.usage.delete(taskId); }
  async inspect({ taskId, tabId, goal, signal }) {
    const settings = this.app.settings.get();
    const cfg = settings.browserVision || {};
    if (cfg.mode === 'off') throw new Error('Browser Vision Rescue is disabled in Settings.');
    const st = this.status(taskId);
    if (!taskId) throw new Error('Vision Rescue requires an active agent task.');
    if (st.remaining <= 0) throw new Error(`Vision Rescue quota exhausted (${st.used}/${st.max}). Ask the user to Take Over.`);
    const providerId = cfg.providerId || settings.activeModel.providerId;
    const provider = settings.providers.find(x => x.id === providerId);
    if (!provider) throw new Error(`Vision provider "${providerId}" not found.`);
    if (!['openai','openrouter','openai-compatible','local'].includes(provider.type)) {
      throw new Error(`Vision Rescue currently needs an OpenAI-compatible vision endpoint. Choose OpenAI, OpenRouter, xAI, Groq, Mistral, Together, Cerebras, or a compatible local server in Settings.`);
    }
    const model = cfg.model || (providerId === settings.activeModel.providerId ? settings.activeModel.model : (provider.models||[])[0]);
    if (!model) throw new Error('Choose a vision model in Settings → Browser Vision.');
    const key = this.app.secrets.get(`llm:${provider.id}`) || '';
    const requiresKey = createProvider(provider, '').requiresKey;
    if (requiresKey && !key) throw new Error(`No API key configured for ${provider.label}.`);

    const viewport = this.app.browserTabs.getViewportSize(tabId);
    const png = await this.app.browserTabs.capturePng(tabId);
    let img = nativeImage.createFromBuffer(png);
    const size = img.getSize();
    if (size.width > 1280) img = img.resize({ width: 1280, quality: 'good' });
    const jpeg = img.toJPEG(68);
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const endpoint = `${String(provider.baseUrl).replace(/\/+$/,'')}/chat/completions`;
    const prompt = `You are the visual fallback for a browser agent. Goal: ${goal}. Inspect the screenshot. Return ONLY JSON with keys: target_found (boolean), description (string), x (integer|null), y (integer|null), confidence (0..1), reason (string). x/y must be screenshot pixel coordinates at the CENTER of the safest target to click. Do not invent a target.`;
    this.usage.set(taskId, st.used + 1);                                                      
    const headers = { 'Content-Type':'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(endpoint, { method:'POST', headers, signal, body: JSON.stringify({
      model, temperature:0, max_tokens:350,
      messages:[{ role:'user', content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:dataUrl,detail:'low'}}]}]
    })});
    if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0,500)}`);
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content || '';
    let parsed; try { parsed = JSON.parse(String(text).replace(/^```json\\s*|```$/g,'').trim()); } catch { throw new Error('Vision model did not return valid JSON.'); }
    const now = this.status(taskId);
    const sent = img.getSize();
    if (Number.isFinite(+parsed.x) && Number.isFinite(+parsed.y) && sent.width && sent.height) {
      parsed.x = Math.round(+parsed.x * viewport.width / sent.width);
      parsed.y = Math.round(+parsed.y * viewport.height / sent.height);
    }
    return { ...parsed, screenshot: { originalWidth:size.width, originalHeight:size.height, sentWidth:sent.width, sentHeight:sent.height, viewportWidth:viewport.width, viewportHeight:viewport.height }, quota: now, provider:provider.id, model };
  }
}
module.exports = { BrowserVisionManager };
