'use strict';
const { OpenAICompatibleProvider } = require('./openai');

                                                                        
class OpenRouterProvider extends OpenAICompatibleProvider {
  headers() {
    return { ...super.headers(), 'HTTP-Referer': 'https://github.com/akhtar-agent', 'X-Title': 'Akhtar Agent' };
  }
}

module.exports = { OpenRouterProvider };
