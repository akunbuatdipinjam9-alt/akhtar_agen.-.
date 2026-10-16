'use strict';
                                                                                                            
class ImageProvider {
  constructor(apiKey) { this.apiKey = apiKey || ''; }
  get label() { return 'Image Provider'; }
  ensureKey() { if (!this.apiKey) throw new Error(`No API key set for ${this.label}.`); }
                                            
  async generate({ prompt, size, signal }) { throw new Error('generate() not implemented'); }
}
module.exports = { ImageProvider };
