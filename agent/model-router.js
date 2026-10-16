'use strict';
                                            
                      
                      
                      
   
const { createProvider } = require('../providers/llm');

const ROUTES = Object.freeze({
  light: { providerId: 'akhtar-xkiro', model: 'xkiro-free-light' },
  mid:   { providerId: 'akhtar-xkiro', model: 'xkiro-free-mid' },
  heavy: { providerId: 'akhtar-xkiro', model: 'xkiro-free-heavy' },
});

function classifyComplexity({ text = '', mode = 'assist', iteration = 0, history = [] } = {}) {
  const s = String(text || '').toLowerCase();
  let score = 0;
  const heavy = /\b(implement|refactor|debug|research|analy[sz]e|audit|project|codebase|architecture|database|migration|deploy|security|multi[- ]?step|browser|terminal|github|supabase|stripe|tool|agent|dokumen|presentasi|riset|analisis|coding|implementasi)\b/i;
  const mid = /\b(explain|summari[sz]e|compare|rewrite|translate|plan|calculate|jelaskan|ringkas|bandingkan|terjemah|hitung|buatkan)\b/i;
  if (mode === 'agent') score += 4;
  else if (mode === 'assist') score += 1;
  if (heavy.test(s)) score += 4;
  if (mid.test(s)) score += 2;
  if (s.length > 1800) score += 4;
  else if (s.length > 500) score += 2;
  if ((history || []).length > 18) score += 2;
  if (iteration > 0) score += 2;                                                        
  if (score >= 5) return 'heavy';
  if (score >= 2) return 'mid';
  return 'light';
}

function routeForRequest(settings, request = {}) {
  if (settings?.routing?.auto === false) return null;
  const tier = classifyComplexity(request);
  const configured = settings?.routing?.[tier];
  return { tier, ...(configured?.providerId && configured?.model ? configured : ROUTES[tier]) };
}

function resolveModel(settings, override) {
  const active = { ...settings.activeModel, ...(override || {}) };
  if (!active.providerId) throw new Error('No model selected. Pick one in Settings → Models.');
  const providerConfig = settings.providers.find((p) => p.id === active.providerId);
  if (!providerConfig) throw new Error(`Unknown provider "${active.providerId}".`);
  if (!active.model) throw new Error(`No model chosen for ${providerConfig.label}. Pick one in Settings → Models.`);
  return { providerConfig, model: active.model };
}

function getProvider(settings, secrets, override, authToken = '') {
  const { providerConfig, model } = resolveModel(settings, override);
  const apiKey = ['supabase-openai', 'supabase-xkiro'].includes(providerConfig.type) ? (authToken || '') : (secrets.get(`llm:${providerConfig.id}`) || '');
  const provider = createProvider(providerConfig, apiKey);
  provider.ensureKey();
  return { provider, model, providerConfig };
}

module.exports = { getProvider, resolveModel, classifyComplexity, routeForRequest, ROUTES };
