'use strict';
const { OpenAICompatibleProvider } = require('./openai');

                                                                                                          
class LocalProvider extends OpenAICompatibleProvider {
  get requiresKey() { return false; }
  get supportsUsage() { return false; }
}

module.exports = { LocalProvider };
