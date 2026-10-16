'use strict';
                                                       
const { LLMProvider, httpError, sseEvents, encodeToolName, decodeToolName, newId, truncatedStream } = require('./provider');

const ALLOWED_SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'enum', 'items', 'format', 'nullable', 'minimum', 'maximum']);

                                                                               
function sanitizeSchema(s) {
  if (Array.isArray(s)) return s.map(sanitizeSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (!ALLOWED_SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, sanitizeSchema(pv)]));
    else if (k === 'items') out[k] = sanitizeSchema(v);
    else if (k === 'type' && Array.isArray(v)) out[k] = v.find((t) => t !== 'null') || 'string';
    else out[k] = v;
  }
  return out;
}

class GeminiProvider extends LLMProvider {
  headers() { return { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }; }

  modelPath(model) { return String(model).replace(/^models\//, ''); }

  toApiContents(messages) {
    const contents = [];
    const push = (role, parts) => {
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts.push(...parts);
      else contents.push({ role, parts: [...parts] });
    };
    for (const m of messages) {
      if (m.role === 'user') push('user', [{ text: m.content || ' ' }]);
      else if (m.role === 'assistant') {
        const parts = [];
        if (m.content && m.content.trim()) parts.push({ text: m.content });
        for (const tc of m.toolCalls || []) {
          const part = { functionCall: { name: encodeToolName(tc.name), args: tc.arguments || {} } };
          if (tc.meta?.thoughtSignature) part.thoughtSignature = tc.meta.thoughtSignature;
          parts.push(part);
        }
        if (parts.length) push('model', parts);
      } else if (m.role === 'tool') {
        let response;
        try { response = JSON.parse(m.content); } catch { response = { result: m.content }; }
        if (!response || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
        push('user', [{ functionResponse: { name: encodeToolName(m.toolName || 'tool'), response } }]);
      }
    }
    return contents;
  }

  async *stream({ model, system, messages, tools = [], signal, maxTokens = 4096, temperature }) {
    this.ensureKey();
    const body = {
      contents: this.toApiContents(messages),
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (typeof temperature === 'number') body.generationConfig.temperature = temperature;
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools.length) {
      body.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: encodeToolName(t.name), description: t.description, parameters: sanitizeSchema(t.inputSchema),
        })),
      }];
    }
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.modelPath(model))}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    if (!res.ok) throw await httpError(res, this.label);

    let usage = null;
    let finishReason = null;
    let produced = false;
    for await (const ev of sseEvents(res)) {
      let j;
      try { j = JSON.parse(ev.data); } catch { continue; }
      if (j.error) throw new Error(`${this.label}: ${j.error.message}`);
      const cand = j.candidates?.[0];
      if (cand?.finishReason) finishReason = cand.finishReason;
      const parts = cand?.content?.parts || [];
      for (const p of parts) {
        if (p.text && !p.thought) { produced = true; yield { type: 'text', delta: p.text }; }
        if (p.functionCall) {
          produced = true;
          yield {
            type: 'tool_call', id: newId(), name: decodeToolName(p.functionCall.name),
            arguments: p.functionCall.args || {},
            meta: p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : undefined,
          };
        }
      }
                                                                                            
      if (j.usageMetadata) usage = { input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount };
    }
    if (!finishReason) throw truncatedStream(this.label);
    if (!produced && finishReason !== 'STOP') {
                                                                                                  
      yield { type: 'text', delta: `[${this.label} returned no answer (finish reason: ${finishReason}).]` };
    }
    if (usage) yield { type: 'usage', usage };
  }

  async getModels() {
    this.ensureKey();
    const res = await fetch(`${this.baseUrl}/models?pageSize=200`, { headers: this.headers() });
    if (!res.ok) throw await httpError(res, this.label);
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
  }
}

module.exports = { GeminiProvider, sanitizeSchema };
