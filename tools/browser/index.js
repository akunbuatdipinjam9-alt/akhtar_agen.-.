'use strict';
   
                                                        
                                                                       
                            
                                                                     
                                                                      
                                                                 
                                                                           
                                                                          
                                                                       
                                                    
   
const fs = require('fs');
const path = require('path');
const { LEVEL } = require('../../permissions/levels');
const { truncate, uid } = require('../../utils/misc');
const { slugify } = require('../../utils/slug');
const { OBSERVE_SCRIPT, GET_TEXT_SCRIPT, GET_LINKS_SCRIPT, buildClickScript, buildTypeScript, buildScrollScript } = require('../../main/browser-accessibility');
const { GET_HTML_SCRIPT, GET_METADATA_SCRIPT, GET_FORMS_SCRIPT, GET_TABLES_SCRIPT, GET_IMAGES_SCRIPT, GET_BUTTONS_SCRIPT, GET_INPUTS_SCRIPT, GET_PAGE_STATE_SCRIPT, buildElementInfoScript, buildSelectOptionScript, buildCheckScript, buildFillFormScript, buildWaitForScript, buildExtractDataScript } = require('../../main/browser-extended-scripts');

const MAX_TEXT = 12000;
const { parseBingRss, parseDuckDuckGoHtml } = require('./web-search');

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MAX_FETCH_BYTES = 3 * 1024 * 1024;

   
                                                                                      
                                                                                     
                                                                              
   
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (/^(fc|fd|fe80)/.test(h) || h.startsWith('::ffff:')) return true;
  return false;
}

function assertPublicHttpUrl(u, { allowPrivate = false } = {}) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http/https URLs are allowed.');
  if (!allowPrivate && isPrivateHost(u.hostname)) throw new Error(`Refusing to fetch a local/private network address (${u.hostname}).`);
}

async function fetchText(url, signal) {
                                                                              
  let current = new URL(url);
                                                                                                   
  const allowPrivate = isPrivateHost(current.hostname);
  let res;
  for (let hop = 0; hop <= 5; hop++) {
    assertPublicHttpUrl(current, { allowPrivate });
    res = await fetch(current, { signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (AkhtarAgent/1.0)' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      current = new URL(res.headers.get('location'), current);
      continue;
    }
    break;
  }
  if (res.status >= 300 && res.status < 400) throw new Error('Too many redirects.');
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${current}`);
  const ct = res.headers.get('content-type') || '';
                                                                                       
  const chunks = []; let size = 0; let truncatedBody = false;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FETCH_BYTES) { truncatedBody = true; chunks.push(value.subarray(0, value.byteLength - (size - MAX_FETCH_BYTES))); try { await reader.cancel(); } catch { /* ignore */ } break; }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return { body, isHtml: ct.includes('html'), finalUrl: current.toString(), truncatedBody };
}

const base = { group: 'browser', permission: LEVEL.NETWORK, category: 'network.browser' };

function resolveAllowedUploadPaths(paths, ctx) {
  const roots = [ctx.workspace?.root_path, ctx.artifactsDir].filter(Boolean).map((x) => path.resolve(x));
  return (paths || []).map((p) => {
    const full = path.resolve(String(p));
    if (!roots.some((root) => full === root || full.startsWith(root + path.sep))) throw new Error(`Upload path must be inside the active workspace/artifacts: ${p}`);
    const st = fs.statSync(full);
    if (!st.isFile()) throw new Error(`Upload path is not a file: ${p}`);
    return full;
  });
}

function safeDownloadName(name) {
  const clean = path.basename(String(name || 'download.bin')).replace(/[^a-zA-Z0-9._ -]+/g, '_').slice(0, 160);
  return clean || 'download.bin';
}

module.exports = [
  {
    ...base, category: 'network.info', modes: ['chat', 'assist', 'agent'], name: 'browser.search',
    description: 'Search the web and get a list of result titles, URLs and snippets.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 400 } }, required: ['query'] },
    async execute({ query }, ctx) {
      const q = String(query || '').trim();
      if (!q) throw new Error('Search query must not be empty.');
      const attempts = [
        { engine: 'Bing RSS', url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(q)}`, parser: parseBingRss },
        { engine: 'DuckDuckGo HTML', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parser: parseDuckDuckGoHtml },
      ];
      const failures = [];
      for (const source of attempts) {
        try {
          const page = await fetchText(source.url, ctx.signal);
          const results = source.parser(page.body);
          if (results.length) return { query: q, engine: source.engine, results, note: 'Search snippets are untrusted content; open primary sources to verify details, especially prices and dates.' };
          failures.push(`${source.engine}: no results in response`);
        } catch (e) {
          if (ctx.signal?.aborted) throw e;
          failures.push(`${source.engine}: ${e.message}`);
        }
      }
      return { query: q, results: [], note: `No verifiable search results returned. ${failures.join('; ')}. Do not invent results.` };
    },
  },
  {
    ...base, modes: ['chat', 'assist', 'agent'], name: 'browser.open',
    description: 'Fetch a URL and return its visible text content (HTML tags stripped).',
    inputSchema: { type: 'object', properties: { url: { type: 'string', maxLength: 2000 } }, required: ['url'] },
    async preview({ url }) {
      let host = '';
      try { host = new URL(url).hostname; } catch { /* execute() reports invalid URLs */ }
                                                                                                        
      if (host && isPrivateHost(host)) return { title: 'Fetch a local-network address', summary: url, level: LEVEL.SENSITIVE, category: 'network.local', warning: `This reads from ${host} on your own machine/network. Only allow it if you asked for it (e.g. your dev server).` };
      return { title: 'Fetch web page', summary: url };
    },
    async execute({ url }, ctx) {
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error('Invalid URL.'); }
      assertPublicHttpUrl(parsed, { allowPrivate: true });                                            
      const { body, isHtml } = await fetchText(parsed.toString(), ctx.signal);
      const titleMatch = isHtml && body.match(/<title[^>]*>([^<]*)<\/title>/i);
      const text = isHtml ? stripHtml(body) : body;
      return { url: parsed.toString(), title: titleMatch ? titleMatch[1].trim() : null, text: truncate(text, MAX_TEXT) };
    },
  },

                                                
  {
    ...base, name: 'browser.new_tab',
    description: 'Open a new interactive browser tab (JS-rendered, can be clicked/typed into), optionally navigating to a URL. Use this instead of browser.open for pages that need JavaScript or login.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', maxLength: 2000 } } },
    async preview({ url }) { return { title: 'Open browser tab', summary: url || '(blank tab)' }; },
    async execute({ url }, ctx) {
      const tab = ctx.browser.newTab(url);
      if (url) await ctx.browser.waitForLoad(tab.id);
      return ctx.browser.list().find((t) => t.id === tab.id) || tab;
    },
  },
  {
    name: 'browser.list_tabs', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'List currently open interactive browser tabs.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) { return { tabs: ctx.browser.list() }; },
  },
  {
    name: 'browser.close_tab', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Close an interactive browser tab.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.closeTab(tab_id); },
  },
  {
    name: 'browser.switch_tab', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Make another open tab the active one.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } }, required: ['tab_id'] },
    async execute({ tab_id }, ctx) { return ctx.browser.switchTab(tab_id); },
  },
  {
    ...base, name: 'browser.navigate',
    description: 'Navigate an interactive tab to a URL (defaults to the active tab).',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, url: { type: 'string', maxLength: 2000 } }, required: ['url'] },
    async preview({ url }) { return { title: 'Navigate browser tab', summary: url }; },
    async execute({ tab_id, url }, ctx) {
      const r = ctx.browser.navigate(tab_id, url);
      await ctx.browser.waitForLoad(tab_id || ctx.browser.activeId);
      return r;
    },
  },
  {
    name: 'browser.observe', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'List interactive elements (links, buttons, inputs) currently visible on the tab, each with a numeric id. Call this before browser.click / browser.type — element ids are only valid until the page next changes.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, OBSERVE_SCRIPT); },
  },
  {
    name: 'browser.get_text', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Get the visible text content of the current page in an interactive tab.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_TEXT_SCRIPT); },
  },
  {
    name: 'browser.get_links', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'List links (text + href) on the current page in an interactive tab.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_LINKS_SCRIPT); },
  },
  {
    name: 'browser.click', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Click an element by the numeric id from browser.observe. Consequential clicks (submit, buy, delete, send) need the user\'s permission, same as any other sensitive action.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, id: { type: 'integer', minimum: 0 } }, required: ['id'] },
    async preview({ id }) { return { title: 'Click page element', summary: `element #${id}` }; },
    async execute({ tab_id, id }, ctx) { return ctx.browser.runScript(tab_id, buildClickScript(id)); },
  },
  {
    name: 'browser.type', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Type text into an input/textarea by the numeric id from browser.observe. Set submit=true to submit the form afterwards (e.g. pressing Enter in a search box).',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'string' }, id: { type: 'integer', minimum: 0 }, text: { type: 'string', maxLength: 5000 }, submit: { type: 'boolean' } },
      required: ['id', 'text'],
    },
    async preview({ id, text }) { return { title: 'Type into page element', summary: `element #${id}: ${truncate(text, 200)}` }; },
    async execute({ tab_id, id, text, submit }, ctx) { return ctx.browser.runScript(tab_id, buildTypeScript(id, text, submit)); },
  },
  {
    name: 'browser.keypress', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Send a single key press to the page (e.g. "Enter", "Escape", "Tab") — useful for submitting forms or dismissing dialogs.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, key: { type: 'string', maxLength: 30 } }, required: ['key'] },
    async preview({ key }) { return { title: 'Send key press', summary: key }; },
    async execute({ tab_id, key }, ctx) {
      await ctx.browser.sendKey(tab_id, { type: 'keyDown', keyCode: key });
      await ctx.browser.sendKey(tab_id, { type: 'keyUp', keyCode: key });
      return { ok: true, key };
    },
  },
  {
    name: 'browser.scroll', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Scroll the page in a direction by a pixel amount (default 600).',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', minimum: 50, maximum: 5000 } },
      required: ['direction'],
    },
    async execute({ tab_id, direction, amount = 600 }, ctx) { return ctx.browser.runScript(tab_id, buildScrollScript(direction, amount)); },
  },
  {
    name: 'browser.wait', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Wait for the tab to finish loading, or for a fixed number of milliseconds (e.g. after a click that triggers a page change).',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, ms: { type: 'integer', minimum: 0, maximum: 30000 } } },
    async execute({ tab_id, ms }, ctx) {
      if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
      else await ctx.browser.waitForLoad(tab_id);
      return { ok: true };
    },
  },
                                                       
  {
    name: 'browser.get_html', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Get a sanitized, size-limited HTML snapshot of the current page. Script contents and sensitive input values are redacted before returning.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_HTML_SCRIPT); },
  },
  {
    name: 'browser.get_metadata', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Read page metadata including title, language, canonical URL, OpenGraph and standard meta fields.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_METADATA_SCRIPT); },
  },
  {
    name: 'browser.get_forms', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Inspect forms and their fields, labels, types, actions and current non-password values.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_FORMS_SCRIPT); },
  },
  {
    name: 'browser.fill_form', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Fill multiple form fields in one call by field name, id, label, aria-label or placeholder. Optionally submit after filling.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, fields: { type: 'object' }, submit: { type: 'boolean' } }, required: ['fields'] },
    async preview({ fields, submit }) { return { title: submit ? 'Fill and submit web form' : 'Fill web form', summary: `${Object.keys(fields || {}).length} field(s)` }; },
    async execute({ tab_id, fields, submit = false }, ctx) { return ctx.browser.runScript(tab_id, buildFillFormScript(fields || {}, submit)); },
  },
  {
    name: 'browser.select_option', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Choose an option in a select/dropdown using an observed element id or CSS selector and an option value/label.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, id: { type: 'integer', minimum: 0 }, selector: { type: 'string', maxLength: 1000 }, value: { type: 'string', maxLength: 1000 }, label: { type: 'string', maxLength: 1000 } } },
    async preview() { return { title: 'Change dropdown selection', summary: 'select option on current page' }; },
    async execute({ tab_id, id, selector, value, label }, ctx) {
      if (id === undefined && !selector) throw new Error('Provide id or selector.');
      if (value === undefined && label === undefined) throw new Error('Provide option value or label.');
      return ctx.browser.runScript(tab_id, buildSelectOptionScript(selector, id, value, label));
    },
  },
  {
    name: 'browser.check', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Check, uncheck, or toggle a checkbox/radio-style element using an observed id or CSS selector.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, id: { type: 'integer', minimum: 0 }, selector: { type: 'string', maxLength: 1000 }, checked: { type: 'boolean' } } },
    async preview({ checked }) { return { title: 'Change checkbox state', summary: checked === undefined ? 'toggle' : (checked ? 'check' : 'uncheck') }; },
    async execute({ tab_id, id, selector, checked }, ctx) {
      if (id === undefined && !selector) throw new Error('Provide id or selector.');
      return ctx.browser.runScript(tab_id, buildCheckScript(selector, id, checked));
    },
  },
  {
    name: 'browser.upload_file', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.upload',
    description: 'Attach one or more files from the active workspace/artifacts to a file input. The tool cannot upload arbitrary files outside those allowed roots.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, selector: { type: 'string', maxLength: 1000 }, paths: { type: 'array', items: { type: 'string', maxLength: 4000 }, minItems: 1, maxItems: 20 } }, required: ['selector', 'paths'] },
    async preview({ paths }) { return { title: 'Attach files to web page', summary: `${(paths || []).length} file(s)`, warning: 'Only files inside the active workspace/artifacts are allowed.' }; },
    async execute({ tab_id, selector, paths }, ctx) {
      const files = resolveAllowedUploadPaths(paths, ctx);
      return ctx.browser.setFileInputFiles(tab_id, selector, files);
    },
  },
  {
    name: 'browser.download', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.download',
    description: 'Download a public http/https URL through the active browser session and save it as an Akhtar artifact.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, url: { type: 'string', maxLength: 4000 }, filename: { type: 'string', maxLength: 200 } }, required: ['url'] },
    async preview({ url }) { return { title: 'Download web file', summary: url }; },
    async execute({ tab_id, url, filename }, ctx) {
      const tab = ctx.browser.list().find((t) => t.id === (tab_id || ctx.browser.activeId));
      const resolved = new URL(url, tab?.url || undefined);
      assertPublicHttpUrl(resolved);
      const dir = ctx.workspace ? path.join(ctx.workspace.root_path, 'akhtar-artifacts') : ctx.artifactsDir;
      fs.mkdirSync(dir, { recursive: true });
      const name = safeDownloadName(filename || path.basename(resolved.pathname) || `download-${Date.now()}.bin`);
      const target = path.join(dir, `${Date.now()}-${name}`);
      const result = await ctx.browser.downloadUrl(tab_id, resolved.toString(), target);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: path.basename(target), path: target, type: 'file' });
      return { ...result, artifactId: artifact.id, verified: fs.existsSync(target) };
    },
  },
  {
    name: 'browser.wait_for', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Wait until a CSS selector or visible text appears on the page. Polls the DOM without consuming Vision Rescue.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, selector: { type: 'string', maxLength: 1000 }, text: { type: 'string', maxLength: 1000 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 30000 }, interval_ms: { type: 'integer', minimum: 50, maximum: 2000 } } },
    async execute({ tab_id, selector, text, timeout_ms = 10000, interval_ms = 250 }, ctx) {
      if (!selector && !text) throw new Error('Provide selector or text.');
      const deadline = Date.now() + timeout_ms;
      let last = { found: false };
      while (Date.now() <= deadline) {
        if (ctx.signal?.aborted) throw new Error('Browser wait_for aborted.');
        last = await ctx.browser.runScript(tab_id, buildWaitForScript(selector, text));
        if (last?.found) return { ...last, waited_ms: timeout_ms - Math.max(0, deadline - Date.now()) };
        await new Promise((r) => setTimeout(r, interval_ms));
      }
      return { ...last, found: false, timed_out: true, waited_ms: timeout_ms };
    },
  },
  {
    name: 'browser.element_info', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Inspect one page element in detail using an observed id or CSS selector: text, safe value, attributes, state and bounds.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, id: { type: 'integer', minimum: 0 }, selector: { type: 'string', maxLength: 1000 } } },
    async execute({ tab_id, id, selector }, ctx) { if (id === undefined && !selector) throw new Error('Provide id or selector.'); return ctx.browser.runScript(tab_id, buildElementInfoScript(selector, id)); },
  },
  {
    name: 'browser.get_tables', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Extract HTML tables as structured rows and cells.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_TABLES_SCRIPT); },
  },
  {
    name: 'browser.extract_data', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Extract structured text/href/src/value data for named CSS selectors in one call.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, selectors: { type: 'object' } }, required: ['selectors'] },
    async execute({ tab_id, selectors }, ctx) { return ctx.browser.runScript(tab_id, buildExtractDataScript(selectors || {})); },
  },
  {
    name: 'browser.get_images', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'List page images with source URL, alt text and dimensions.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_IMAGES_SCRIPT); },
  },
  {
    name: 'browser.get_buttons', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'List buttons and button-like elements with labels and disabled state.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_BUTTONS_SCRIPT); },
  },
  {
    name: 'browser.get_inputs', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'List inputs, textareas and selects with names, types, placeholders and safe current state.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_INPUTS_SCRIPT); },
  },
  {
    name: 'browser.get_page_state', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Read current browser page state: URL/title/readiness/viewport/scroll and high-level DOM counts.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.runScript(tab_id, GET_PAGE_STATE_SCRIPT); },
  },
  {
    name: 'browser.history', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Read navigation history for the interactive tab, including whether back/forward are available.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { return ctx.browser.history(tab_id); },
  },
  {
    name: 'browser.back', group: 'browser', permission: LEVEL.NETWORK, category: 'network.browser',
    description: 'Navigate the interactive tab one step backward in its history.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { ctx.browser.goBack(tab_id); await ctx.browser.waitForLoad(tab_id); return { ok: true, direction: 'back' }; },
  },
  {
    name: 'browser.forward', group: 'browser', permission: LEVEL.NETWORK, category: 'network.browser',
    description: 'Navigate the interactive tab one step forward in its history.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { ctx.browser.goForward(tab_id); await ctx.browser.waitForLoad(tab_id); return { ok: true, direction: 'forward' }; },
  },
  {
    name: 'browser.reload', group: 'browser', permission: LEVEL.NETWORK, category: 'network.browser',
    description: 'Reload the current interactive browser page and wait for loading to settle.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) { ctx.browser.reload(tab_id); await ctx.browser.waitForLoad(tab_id); return { ok: true, reloaded: true }; },
  },

  {
    name: 'browser.vision_rescue', group: 'browser', permission: LEVEL.NETWORK, category: 'network.browser',
    description: 'EXPENSIVE FALLBACK ONLY. After DOM/accessibility/text matching has failed, send one compressed screenshot to the configured vision model to locate a visual target. Limited per task (default 3). Do not call routinely.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, goal: { type: 'string', maxLength: 500 } }, required: ['goal'] },
    async preview({ goal }) { return { title: 'Use Browser Vision Rescue', summary: goal, warning: 'Consumes one vision rescue from this task quota.' }; },
    async execute({ tab_id, goal }, ctx) {
      if (!ctx.browserVision) throw new Error('Browser Vision Rescue is unavailable.');
      return ctx.browserVision.inspect({ taskId: ctx.taskId, tabId: tab_id, goal, signal: ctx.signal });
    },
  },
  {
    name: 'browser.click_at', group: 'browser', permission: LEVEL.SENSITIVE, category: 'browser.interact',
    description: 'Click browser viewport coordinates, normally only after browser.vision_rescue identifies a target. Coordinates are in the CURRENT browser viewport.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } }, required: ['x','y'] },
    async preview({ x,y }) { return { title: 'Click visual browser target', summary: `viewport (${x}, ${y})` }; },
    async execute({ tab_id, x, y }, ctx) {
      ctx.browser.sendInputEvent(tab_id, { type:'mouseMove', x, y });
      ctx.browser.sendInputEvent(tab_id, { type:'mouseDown', x, y, button:'left', clickCount:1 });
      ctx.browser.sendInputEvent(tab_id, { type:'mouseUp', x, y, button:'left', clickCount:1 });
      return { ok:true, x, y };
    },
  },
  {
    name: 'browser.screenshot', group: 'browser', permission: LEVEL.NONE, category: 'none',
    description: 'Capture a screenshot of the current tab and save it as an artifact.',
    inputSchema: { type: 'object', properties: { tab_id: { type: 'string' } } },
    async execute({ tab_id }, ctx) {
      const png = await ctx.browser.capturePng(tab_id);
      const dir = ctx.workspace ? path.join(ctx.workspace.root_path, 'akhtar-artifacts') : ctx.artifactsDir;
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `screenshot-${slugify(String(Date.now()))}-${uid().slice(0, 6)}.png`);
      fs.writeFileSync(filePath, png);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: path.basename(filePath), path: filePath, type: 'image' });
      return { artifactId: artifact.id, path: filePath, verified: fs.existsSync(filePath) };
    },
  },
];

module.exports._internals = { isPrivateHost, fetchText };
