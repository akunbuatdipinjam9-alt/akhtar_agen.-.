'use strict';
                              
const { LLMProvider, ProviderError, httpError, sseEvents, encodeToolName, decodeToolName, parseArgs, truncatedStream } = require('./provider');

class AnthropicProvider extends LLMProvider {
  headers() {
    return { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' };
  }

  toApiMessages(messages) {
    const out = [];
    const push = (role, blocks) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else out.push({ role, content: [...blocks] });
    };
    for (const m of messages) {
      if (m.role === 'user') push('user', [{ type: 'text', text: m.content || ' ' }]);
      else if (m.role === 'assistant') {
        const blocks = [];
        if (m.content && m.content.trim()) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls || []) {
          blocks.push({ type: 'tool_use', id: tc.id, name: encodeToolName(tc.name), input: tc.arguments || {} });
        }
        if (blocks.length) push('assistant', blocks);
      } else if (m.role === 'tool') {
        push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '' }]);
      }
    }
    return out;
  }

  async *stream({ model, system, messages, tools = [], signal, maxTokens = 4096, temperature }) {
    this.ensureKey();
    const body = { model, max_tokens: maxTokens, system, messages: this.toApiMessages(messages), stream: true };
    if (typeof temperature === 'number') body.temperature = Math.min(1, temperature);
    if (tools.length) {
      body.tools = tools.map((t) => ({ name: encodeToolName(t.name), description: t.description, input_schema: t.inputSchema }));
    }
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw await httpError(res, this.label);

    const blocks = {};
    let inputTokens = 0;
    let finished = false;
    for await (const ev of sseEvents(res)) {
      let j;
      try { j = JSON.parse(ev.data); } catch { continue; }
      switch (j.type) {
        case 'message_start':
          inputTokens = j.message?.usage?.input_tokens || 0;
          break;
        case 'content_block_start':
          if (j.content_block?.type === 'tool_use') {
            blocks[j.index] = { id: j.content_block.id, name: j.content_block.name, json: '' };
          }
          break;
        case 'content_block_delta':
          if (j.delta?.type === 'text_delta' && j.delta.text) yield { type: 'text', delta: j.delta.text };
          else if (j.delta?.type === 'input_json_delta' && blocks[j.index]) blocks[j.index].json += j.delta.partial_json || '';
          break;
        case 'content_block_stop': {
          const b = blocks[j.index];
          if (b) {
            yield { type: 'tool_call', id: b.id, name: decodeToolName(b.name), arguments: parseArgs(b.json) };
            delete blocks[j.index];
          }
          break;
        }
        case 'message_delta':
          if (j.usage) yield { type: 'usage', usage: { input: inputTokens, output: j.usage.output_tokens } };
          break;
        case 'message_stop':
          finished = true;
          break;
        case 'error': {
                                                                                                 
          const type = j.error?.type || '';
          throw new ProviderError(`${this.label}: ${j.error?.message || 'stream error'}${type ? ` (${type})` : ''}`, 0, /overloaded|api_error|rate_limit/.test(type));
        }
        default:
          break;
      }
    }
                                                                                                   
    if (!finished) throw truncatedStream(this.label);
  }

  async getModels() {
    this.ensureKey();
    const res = await fetch(`${this.baseUrl}/v1/models?limit=100`, { headers: this.headers() });
    if (!res.ok) throw await httpError(res, this.label);
    const j = await res.json();
    return (j.data || []).map((m) => m.id).sort();
  }
}

module.exports = { AnthropicProvider };
