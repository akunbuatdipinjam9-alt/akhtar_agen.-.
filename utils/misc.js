'use strict';
const crypto = require('crypto');

const uid = () => crypto.randomUUID();
const now = () => Date.now();

function truncate(str, max, note = '… [truncated]') {
  if (typeof str !== 'string') return str;
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n${note} (${str.length - max} more chars)`;
}

function tail(str, max) {
  if (typeof str !== 'string' || str.length <= max) return str;
  return `[… ${str.length - max} earlier chars omitted]\n` + str.slice(-max);
}

function stripAnsi(s) {
                                              
  return String(s).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g, '');
}

function sha256(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function isBinary(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

class AbortError extends Error {
  constructor(reason = 'aborted') {
    super(reason === 'timeout' ? 'Run timed out' : 'Stopped by user');
    this.name = 'AbortError';
    this.reason = reason;
  }
}

function isAbort(err, signal) {
  return (signal && signal.aborted) || err?.name === 'AbortError';
}

module.exports = { uid, now, truncate, tail, stripAnsi, sha256, isBinary, AbortError, isAbort };
