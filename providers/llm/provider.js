'use strict';
   
                                             
  
                                                      
                                                            
                                                                   
                                                               
  
                          
                            
                                                      
                                                
   
const { randomUUID } = require('crypto');
const { redact } = require('../../utils/logger');

                                                                                
const encodeToolName = (name) => name.replace(/\./g, '__');
const decodeToolName = (name) => String(name || '').replace(/__/g, '.');

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (!raw || !String(raw).trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : { __invalid_json: String(raw) };
  } catch { return { __invalid_json: String(raw) }; }
}

class ProviderError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

async function httpError(res, label) {
  let body = '';
  try { body = await res.text(); } catch { /* ignore */ }
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message || j.message || j.error || body; } catch { /* not json */ }
  const raHeader = res.headers?.get?.('retry-after');
  const ra = raHeader == null ? NaN : Number(raHeader);
  const retryAfterMs = Number.isFinite(ra) && ra >= 0 ? ra * 1000 : null;
  const quotaExceeded = /quota exceeded|insufficient (quota|credits)|credit balance|out of credits|daily (usage )?limit|monthly (usage )?limit|free.tier limit/i.test(String(msg));
  const retryable = (res.status === 429 || res.status === 408 || res.status === 529 || res.status >= 500) && !quotaExceeded && !(retryAfterMs !== null && retryAfterMs > 30000);
  const err = new ProviderError(`${label} HTTP ${res.status}: ${redact(String(msg)).slice(0, 500)}`, res.status, retryable);
  if (retryAfterMs !== null) err.retryAfterMs = retryAfterMs;
  return err;
}

const SSE_IDLE_MS = 150000;                                                                    

   
                                            
                                                                                        
                                                                             
   
async function* sseEvents(res, { idleMs = SSE_IDLE_MS } = {}) {
  const decoder = new TextDecoder();
  let buf = '';
  let event = null;
  let data = [];
  const flush = function* () {
    if (data.length) yield { event, data: data.join('\n') };
    event = null;
    data = [];
  };
  const lines = function* () {
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') { yield* flush(); continue; }
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) event = line.slice(6).trim();
    }
  };
                                                                                                 
  const reader = typeof res.body?.getReader === 'function' ? res.body.getReader() : (() => {
    const it = res.body[Symbol.asyncIterator]();
    return { read: () => it.next(), cancel: async () => { it.return?.(); }, releaseLock() {} };
  })();
  let done = false;
  try {
    for (;;) {
      let timer;
      const idle = new Promise((_, reject) => { timer = setTimeout(() => reject(new ProviderError(`Stream stalled: no data for ${Math.round(idleMs / 1000)}s`, 0, true)), idleMs); });
      let step;
      try { step = await Promise.race([reader.read(), idle]); } finally { clearTimeout(timer); }
      if (step.done) { done = true; break; }
      buf += decoder.decode(step.value, { stream: true });
      yield* lines();
    }
    buf += decoder.decode();                                         
    buf += '\n';
    yield* lines();
    yield* flush();
  } finally {
                                                                                           
                                                                                   
    if (!done) reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* pending read */ }
  }
}

                                                                               
function truncatedStream(label) {
  return new ProviderError(`${label}: the response stream ended unexpectedly (connection dropped).`, 0, true);
}

                                                                                     
function isRetryableModelError(e) {
  if (!e || e.name === 'AbortError') return false;
  if (e.retryable === true) return true;
  if (e.retryable === false) return false;
  return /overloaded|rate.?limit|too many requests|econnreset|etimedout|socket hang up|fetch failed|network|temporarily unavailable|stream (ended|stalled)/i.test(String(e.message || ''));
}

class LLMProvider {
  constructor(config, apiKey) {
    this.config = config;
    this.apiKey = apiKey || '';
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  }

  get label() { return this.config.label || this.config.id; }
  get requiresKey() { return true; }

                                           
  async *stream(_opts) { throw new Error('stream() not implemented'); }

                                                     
  async generate(opts) {
    let text = '';
    const toolCalls = [];
    let usage = null;
    for await (const ev of this.stream(opts)) {
      if (ev.type === 'text') text += ev.delta;
      else if (ev.type === 'tool_call') toolCalls.push(ev);
      else if (ev.type === 'usage') usage = ev.usage;
    }
    return { text, toolCalls, usage };
  }

                                                                                      
  async toolCall(opts) { return this.generate(opts); }

  async getModels() { return []; }

  ensureKey() {
    if (this.requiresKey && !this.apiKey) throw new ProviderError(`No API key set for ${this.label}. Add it in Settings → Models.`, 0, false);
  }
}

const newId = () => 'call_' + randomUUID().replace(/-/g, '').slice(0, 20);

module.exports = { LLMProvider, ProviderError, httpError, sseEvents, encodeToolName, decodeToolName, parseArgs, newId, truncatedStream, isRetryableModelError };
