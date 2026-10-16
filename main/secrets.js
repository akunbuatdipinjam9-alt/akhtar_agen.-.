'use strict';
   
                                                                   
                                                                       
                                                   
   
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { logger } = require('../utils/logger');

class SecretStore {
  constructor(file) {
    this.file = file;
    this.data = this._load();
  }

  _load() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch { return {}; }               
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      throw new Error('not an object');
    } catch (e) {
                                                                                            
                                                                          
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(this.file, backup); } catch { /* ignore */ }
      logger.error(`Secret store unreadable; backed up to ${backup}`, e);
      return {};
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    try { fs.renameSync(tmp, this.file); }
    catch (e) {
                                                                                                            
      fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      logger.app('warn', 'Secret store rename failed; wrote directly', { code: e.code });
    }
  }

  isSecure() {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  set(name, value) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid secret name.');
    if (value !== null && value !== undefined && typeof value !== 'string') throw new Error('Secret value must be a string.');
    if (!value) { delete this.data[name]; this._save(); return; }
    if (this.isSecure()) {
      this.data[name] = { enc: true, v: safeStorage.encryptString(value).toString('base64') };
    } else {
      logger.app('warn', 'OS credential storage unavailable; secret stored obfuscated only', { name });
      this.data[name] = { enc: false, v: Buffer.from(value, 'utf8').toString('base64') };
    }
    this._save();
  }

  get(name) {
    if (!Object.prototype.hasOwnProperty.call(this.data, name)) return null;
    const e = this.data[name];
    if (!e) return null;
    try {
      return e.enc ? safeStorage.decryptString(Buffer.from(e.v, 'base64')) : Buffer.from(e.v, 'base64').toString('utf8');
    } catch (err) {
      logger.error(`Could not decrypt secret ${name}`, err);
      return null;
    }
  }

                                                                                             
                                                                                                 
  has(name) { return Object.prototype.hasOwnProperty.call(this.data, name) && this.get(name) !== null; }
}

module.exports = { SecretStore };
