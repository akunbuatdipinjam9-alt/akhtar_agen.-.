'use strict';
                                                                             
const { LLMProvider, httpError, sseEvents, encodeToolName, decodeToolName, parseArgs, newId, truncatedStream } = require('./provider');

class OpenAIProvider extends LLMProvider {
  get supportsUsage() { return true; }

                                                                                        
  get chatCompletionsUrl() { return `${this.baseUrl}/chat/completions`; }
  get modelsUrl() { return `${this.baseUrl}/models`; }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

                                                       
  decorateBody(body, opts) {
                                                                                    
    body.max_completion_tokens = opts.maxTokens;
    return body;
  }

  toApiMessages(system, messages) {
    const out = [];
    if (system) out.push({ role: 'system', content: system });
    for (const m of messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.content || '' });
      else if (m.role === 'assistant') {
        const msg = { role: 'assistant', content: m.content || (m.toolCalls?.length ? null : '') };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id, type: 'function',
            function: { name: encodeToolName(tc.name), arguments: JSON.stringify(tc.arguments || {}) },
          }));
        }
        out.push(msg);
      } else if (m.role === 'tool') {
        out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '' });
      }
    }
    return out;
  }

  async *stream({ model, system, messages, tools = [], signal, maxTokens = 4096, temperature }) {
    this.ensureKey();
    let body = { model, messages: this.toApiMessages(system, messages), stream: true };
    if (tools.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: encodeToolName(t.name), description: t.description, parameters: t.inputSchema },
      }));
    }
    if (this.supportsUsage) body.stream_options = { include_usage: true };
    body = this.decorateBody(body, { maxTokens, temperature });

    const res = await fetch(this.chatCompletionsUrl, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw await httpError(res, this.label);

    const calls = new Map();
    const lastKeyForIndex = new Map();
    let finished = false;
    for await (const ev of sseEvents(res)) {
      if (ev.data === '[DONE]') { finished = true; break; }
      let j;
      try { j = JSON.parse(ev.data); } catch { continue; }
      if (j.error) throw new Error(`${this.label}: ${j.error.message || JSON.stringify(j.error)}`);
      if (j.usage) yield { type: 'usage', usage: { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } };
      const choice = j.choices && j.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finished = true;
      const d = choice.delta || {};
      if (typeof d.content === 'string' && d.content) yield { type: 'text', delta: d.content };
      if (Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          const idx = tc.index ?? 0;
                                                                                                   
                                                                                         
                                                                                     
          let key = lastKeyForIndex.get(idx) ?? `${idx}#0`;
          const existing = calls.get(key);
          if (tc.id && existing?.id && existing.id !== tc.id) key = `${idx}#${calls.size}`;
          lastKeyForIndex.set(idx, key);
          const cur = calls.get(key) || { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name && !cur.name.endsWith(tc.function.name)) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(key, cur);
        }
      }
    }
    if (!finished) throw truncatedStream(this.label);
    for (const c of calls.values()) {
      if (!c.name) continue;
      yield { type: 'tool_call', id: c.id || newId(), name: decodeToolName(c.name), arguments: parseArgs(c.args) };
    }
  }

  async getModels() {
    const res = await fetch(this.modelsUrl, { headers: this.headers() });
    if (!res.ok) throw await httpError(res, this.label);
    const j = await res.json();
    return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
  }
}

                                                                                   
class OpenAICompatibleProvider extends OpenAIProvider {
  decorateBody(body, { maxTokens, temperature }) {
    body.max_tokens = maxTokens;
    if (typeof temperature === 'number') body.temperature = temperature;
    return body;
  }
}

module.exports = { OpenAIProvider, OpenAICompatibleProvider };
