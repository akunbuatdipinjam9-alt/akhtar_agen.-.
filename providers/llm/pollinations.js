'use strict';
   
                                                                      
                                                                     
                                                                  
                                                                        
  
                                             
                                                                                    
  
                                                               
                                                                      
                                                                        
                                                                   
                                            
   
const { OpenAICompatibleProvider } = require('./openai');

class PollinationsTextProvider extends OpenAICompatibleProvider {
  get label() { return this.config.label || 'Pollinations'; }
  get requiresKey() { return false; }
  get supportsUsage() { return false; }                                                                      
  get chatCompletionsUrl() { return `${this.baseUrl}/openai`; }
}

module.exports = { PollinationsTextProvider };
