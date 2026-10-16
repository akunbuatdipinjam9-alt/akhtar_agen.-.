'use strict';
   
             
                                                                               
                                                             
  
         
                                                                 
                                       
                                                                       
                                                                     
   

const SENSITIVE_KEY_RE = /(?:api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|service[_-]?role|cookie|set-cookie|session|credential|client[_-]?secret|private[_-]?key|jwt)/i;
const BINARY_KEY_RE = /(?:base64|image[_-]?data|audio[_-]?data|video[_-]?data|binary|blob|bytes|screenshot[_-]?data)/i;
const SECRET_VALUE_RE = /^(?:sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

function redactString(value, key, maxString) {
  const s = String(value ?? '');
  if (key && SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
  if (SECRET_VALUE_RE.test(s.trim())) return '[REDACTED]';
  if (key && BINARY_KEY_RE.test(key) && s.length > 256) return `[BINARY_DATA ${s.length} chars]`;
  if (s.length > maxString) return `${s.slice(0, Math.max(0, maxString - 32))}… [TRUNCATED ${s.length - maxString} chars]`;
  return s;
}

function sanitizeToolData(value, options = {}, state = null, key = '') {
  const cfg = {
    maxDepth: options.maxDepth ?? 7,
    maxString: options.maxString ?? 3500,
    maxArray: options.maxArray ?? 40,
    maxKeys: options.maxKeys ?? 80,
  };
  const st = state || { depth: 0, seen: new WeakSet(), truncated: false };
  if (!st.root) st.root = st;

  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') {
    const out = redactString(value, key, cfg.maxString);
    if (out !== value && (out.includes('TRUNCATED') || out.includes('BINARY_DATA'))) st.root.truncated = true;
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return `[${typeof value}]`;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    st.root.truncated = true;
    return `[BINARY_DATA ${value.length} bytes]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message, 'message', cfg.maxString), code: value.code || null };

  if (typeof value === 'object') {
    if (st.seen.has(value)) return '[CIRCULAR]';
    if (st.depth >= cfg.maxDepth) { st.root.truncated = true; return '[MAX_DEPTH]'; }
    st.seen.add(value);
    const nextState = { ...st, depth: st.depth + 1, seen: st.seen, root: st.root };

    if (Array.isArray(value)) {
      const sliced = value.slice(0, cfg.maxArray).map((v) => sanitizeToolData(v, cfg, nextState, ''));
      if (value.length > cfg.maxArray) {
        st.root.truncated = true;
        sliced.push(`[+${value.length - cfg.maxArray} more items]`);
      }
      st.seen.delete(value);
      return sliced;
    }

    const out = {};
    const entries = Object.entries(value);
    for (const [k, v] of entries.slice(0, cfg.maxKeys)) {
      out[k] = SENSITIVE_KEY_RE.test(k)
        ? '[REDACTED]'
        : sanitizeToolData(v, cfg, nextState, k);
    }
    if (entries.length > cfg.maxKeys) {
      st.root.truncated = true;
      out._tool_sense_truncated_keys = entries.length - cfg.maxKeys;
    }
    st.seen.delete(value);
    return out;
  }

  return String(value);
}

function splitVerification(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { data: result, verification: null };
  }
  const data = { ...result };
  const internalVerification = data._verification ?? null;
  const beforeAfter = data._beforeAfter ?? null;
  delete data._verification;
  delete data._beforeAfter;

  let status = 'not_available';
  if (beforeAfter) status = beforeAfter.confirmed === true ? 'confirmed' : 'checked_but_unconfirmed';
  else if (internalVerification?.ok === true || internalVerification?.confirmed === true) status = 'confirmed';
  else if (internalVerification) status = 'checked';

  const verification = (internalVerification || beforeAfter) ? {
    status,
    tool_verification: internalVerification,
    before_after: beforeAfter,
  } : null;
  return { data, verification };
}

function buildToolObservation({ callId, toolName, status = 'success', result = null, error = null, meta = null }) {
  const state = { depth: 0, seen: new WeakSet(), truncated: false };
  const { data, verification } = splitVerification(result);
  const observation = {
    schema: 'TOOL_SENSE_V1',
    call_id: callId || null,
    tool: toolName || null,
    status,
    observed_at: new Date().toISOString(),
    data: status === 'success' ? sanitizeToolData(data, {}, state) : null,
    error: error ? sanitizeToolData(error, { maxString: 1800 }, state) : null,
    verification: verification ? sanitizeToolData(verification, { maxString: 1800 }, state) : null,
  };
  if (meta) observation.meta = sanitizeToolData(meta, { maxString: 1000, maxArray: 15 }, state);
  if (state.truncated) observation.truncated = true;
  return observation;
}

function serializeToolObservation(observation, maxChars = 19000) {
  let json = JSON.stringify(observation);
  if (json.length <= maxChars) return json;

                                                                
  const compact = {
    ...observation,
    data: sanitizeToolData(observation.data, { maxDepth: 5, maxString: 1200, maxArray: 12, maxKeys: 40 }),
    verification: sanitizeToolData(observation.verification, { maxDepth: 4, maxString: 800, maxArray: 10, maxKeys: 30 }),
    meta: sanitizeToolData(observation.meta, { maxDepth: 3, maxString: 500, maxArray: 8, maxKeys: 20 }),
    truncated: true,
  };
  json = JSON.stringify(compact);
  if (json.length <= maxChars) return json;

  const minimal = {
    schema: 'TOOL_SENSE_V1',
    call_id: observation.call_id,
    tool: observation.tool,
    status: observation.status,
    observed_at: observation.observed_at,
    data: sanitizeToolData(observation.data, { maxDepth: 3, maxString: 600, maxArray: 6, maxKeys: 20 }),
    error: sanitizeToolData(observation.error, { maxDepth: 2, maxString: 600, maxArray: 4, maxKeys: 12 }),
    verification: observation.verification ? { status: observation.verification.status || 'checked' } : null,
    truncated: true,
  };
  return JSON.stringify(minimal);
}

function successObservation(call, result) {
  return buildToolObservation({ callId: call?.id, toolName: call?.name, status: 'success', result });
}

function errorObservation(call, error, meta = null, status = 'failed') {
  return buildToolObservation({
    callId: call?.id,
    toolName: call?.name,
    status,
    error: { name: error?.name || 'Error', message: error?.message || String(error || 'Tool failed'), code: error?.code || null },
    meta,
  });
}

module.exports = {
  SENSITIVE_KEY_RE,
  BINARY_KEY_RE,
  sanitizeToolData,
  buildToolObservation,
  serializeToolObservation,
  successObservation,
  errorObservation,
};
