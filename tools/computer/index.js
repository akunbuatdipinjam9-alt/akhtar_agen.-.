'use strict';
   
                                                                          
  
                                                                      
                                                                   
                                                             
                                                                      
                                                                      
                                                                    
                                                                  
                                                                        
                                                                     
                                                                    
                                                                       
                                              
  
                                                         
                                                                         
                                                                       
                                                                     
                                                                       
                                                                     
                                                                    
                                                                    
                                                                    
  
                                                                  
                                                                        
                                    
   
const fs = require('fs');
const path = require('path');
const { LEVEL } = require('../../permissions/levels');
const { truncate, uid } = require('../../utils/misc');
const { slugify } = require('../../utils/slug');
const { OBSERVE_SCRIPT, GET_TEXT_SCRIPT, buildClickScript, buildDoubleClickScript, buildRightClickScript, buildHoverScript, buildGetValueScript, buildTypeScript, buildScrollScript } = require('../../main/browser-accessibility');

const TAB_NAME = 'computer-control';

function resolveUrl(ctx, url) {
  const target = url || ctx.settings.computerControl?.osUrl || ctx.osBundleUrl;
  if (!target) throw new Error('No simulated desktop URL configured and no bundled one found. Set one in Settings → Computer Control, or pass "url" to computer.open.');
  return target;
}

                                                                          
function openTabId(ctx) {
  const id = ctx.browser.named.get(TAB_NAME);
  if (!id || !ctx.browser.tabs.has(id)) throw new Error('No simulated desktop is open yet. Call computer.open first.');
  return id;
}

const base = { group: 'computer', permission: LEVEL.NETWORK, category: 'network.computer' };

module.exports = [
  {
    ...base, name: 'computer.open',
    description: 'Open (or focus) the simulated desktop. Defaults to the bundled Akhtar OS (os/akhtar-os.html) unless a URL is configured in Settings → Computer Control or passed here. Call this before any other computer.* tool.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', maxLength: 2000, description: 'Overrides the configured/bundled OS URL for this call.' } } },
    async preview({ url }, ctx) { return { title: 'Open simulated desktop', summary: url || ctx.settings.computerControl?.osUrl || ctx.osBundleUrl || '(not configured)' }; },
    async execute({ url }, ctx) {
      const existingId = ctx.browser.named.get(TAB_NAME);
      if (existingId && ctx.browser.tabs.has(existingId)) {
        if (url) throw new Error('The simulated desktop is already open and cannot be redirected to a different URL from computer.open — it holds a privileged file-system bridge. Use browser.new_tab / browser.navigate for other sites, or computer.close first to reopen with a different URL.');
        await ctx.browser.waitForLoad(existingId);
        return ctx.browser.list().find((t) => t.id === existingId);
      }
      const target = resolveUrl(ctx, url);
                                                                                                
                                                                                                    
      const trusted = !url || url === ctx.osBundleUrl || url === ctx.settings.computerControl?.osUrl;
      const tabId = ctx.browser.ensureNamedTab(TAB_NAME, target, trusted ? { preload: ctx.osPreloadPath } : {});
      await ctx.browser.waitForLoad(tabId);
      return ctx.browser.list().find((t) => t.id === tabId);
    },
  },
  {
    name: 'computer.close', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Close the simulated desktop tab. Needed before computer.open can point it at a different URL.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) {
      const id = ctx.browser.named.get(TAB_NAME);
      if (!id || !ctx.browser.tabs.has(id)) return { closed: false, reason: 'not open' };
      return ctx.browser.closeTab(id);
    },
  },
  {
    name: 'computer.window_info', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Get the simulated desktop\'s current title and URL ("window information").',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) {
      const id = openTabId(ctx);
      const t = ctx.browser.list().find((x) => x.id === id);
      return { title: t?.title, url: t?.url };
    },
  },
  {
    name: 'computer.observe', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'List interactive elements currently visible on the simulated desktop (icons, windows, buttons, inputs), each with a numeric id. Call again after anything changes — ids don\'t survive a page change.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) { return ctx.browser.runScript(openTabId(ctx), OBSERVE_SCRIPT); },
  },
  {
    name: 'computer.get_text', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Get the visible text currently on the simulated desktop.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) { return ctx.browser.runScript(openTabId(ctx), GET_TEXT_SCRIPT); },
  },
  {
    name: 'computer.screenshot', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Capture a screenshot of the simulated desktop and save it as an artifact.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_a, ctx) {
      const png = await ctx.browser.capturePng(openTabId(ctx));
      const dir = ctx.workspace ? path.join(ctx.workspace.root_path, 'akhtar-artifacts') : ctx.artifactsDir;
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `desktop-${slugify(String(Date.now()))}-${uid().slice(0, 6)}.png`);
      fs.writeFileSync(filePath, png);
      const artifact = ctx.artifacts.create({ workspaceId: ctx.workspaceId, taskId: ctx.taskId, name: path.basename(filePath), path: filePath, type: 'image' });
      return { artifactId: artifact.id, path: filePath, verified: fs.existsSync(filePath) };
    },
  },
  {
    name: 'computer.click', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Click an element on the simulated desktop by the numeric id from computer.observe.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 0 } }, required: ['id'] },
    async preview({ id }) { return { title: 'Click on simulated desktop', summary: `element #${id}` }; },
    async execute({ id }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildClickScript(id)); },
  },
  {
    name: 'computer.type', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Type text into an input on the simulated desktop by the numeric id from computer.observe.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 0 }, text: { type: 'string', maxLength: 5000 }, submit: { type: 'boolean' } },
      required: ['id', 'text'],
    },
    async preview({ id, text }) { return { title: 'Type on simulated desktop', summary: `element #${id}: ${truncate(text, 200)}` }; },
    async execute({ id, text, submit }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildTypeScript(id, text, submit)); },
  },
  {
    name: 'computer.keypress', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Send a single key press to the simulated desktop (e.g. "Enter", "Escape").',
    inputSchema: { type: 'object', properties: { key: { type: 'string', maxLength: 30 } }, required: ['key'] },
    async preview({ key }) { return { title: 'Send key press to simulated desktop', summary: key }; },
    async execute({ key }, ctx) {
      const id = openTabId(ctx);
      await ctx.browser.sendKey(id, { type: 'keyDown', keyCode: key });
      await ctx.browser.sendKey(id, { type: 'keyUp', keyCode: key });
      return { ok: true, key };
    },
  },
  {
    name: 'computer.scroll', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Scroll the simulated desktop in a direction by a pixel amount (default 600).',
    inputSchema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', minimum: 50, maximum: 5000 } },
      required: ['direction'],
    },
    async execute({ direction, amount = 600 }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildScrollScript(direction, amount)); },
  },

                                                                                                          
  {
    name: 'computer.double_click', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Double-click an element by the numeric id from computer.observe.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 0 } }, required: ['id'] },
    async preview({ id }) { return { title: 'Double-click on simulated desktop', summary: `element #${id}` }; },
    async execute({ id }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildDoubleClickScript(id)); },
  },
  {
    name: 'computer.right_click', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Right-click an element by the numeric id from computer.observe (opens a context menu, if the page has one).',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 0 } }, required: ['id'] },
    async preview({ id }) { return { title: 'Right-click on simulated desktop', summary: `element #${id}` }; },
    async execute({ id }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildRightClickScript(id)); },
  },
  {
    name: 'computer.hover', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Hover the pointer over an element by id (triggers hover states/tooltips/menus) without clicking.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 0 } }, required: ['id'] },
    async execute({ id }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildHoverScript(id)); },
  },
  {
    name: 'computer.get_value', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Read the current value/text/checked state of an element by id — useful for verifying a click or type actually took effect.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 0 } }, required: ['id'] },
    async execute({ id }, ctx) { return ctx.browser.runScript(openTabId(ctx), buildGetValueScript(id)); },
  },
  {
    name: 'computer.move_mouse', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Move the real pointer to exact pixel coordinates (x, y from the top-left of the desktop view). Use when you need precise positioning that an element id can\'t express, e.g. before computer.drag.',
    inputSchema: { type: 'object', properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } }, required: ['x', 'y'] },
    async execute({ x, y }, ctx) { ctx.browser.sendInputEvent(openTabId(ctx), { type: 'mouseMove', x, y }); return { ok: true, x, y }; },
  },
  {
    name: 'computer.click_at', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Click at exact pixel coordinates using a real mouse event (not a DOM element id). Use computer.click by id when possible; use this for canvas-drawn UI that has no DOM elements to target.',
    inputSchema: { type: 'object', properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, button: { type: 'string', enum: ['left', 'right', 'middle'] } }, required: ['x', 'y'] },
    async preview({ x, y }) { return { title: 'Click at coordinates', summary: `(${x}, ${y})` }; },
    async execute({ x, y, button = 'left' }, ctx) {
      const id = openTabId(ctx);
      ctx.browser.sendInputEvent(id, { type: 'mouseDown', x, y, button, clickCount: 1 });
      ctx.browser.sendInputEvent(id, { type: 'mouseUp', x, y, button, clickCount: 1 });
      return { ok: true, x, y, button };
    },
  },
  {
    name: 'computer.drag', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Drag from one point to another (real mouse events) — for drag-and-drop UI like moving a window or reordering items.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
        to: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
        steps: { type: 'integer', minimum: 2, maximum: 60, description: 'Intermediate mouse-move points for a smoother drag (default 12).' },
      },
      required: ['from', 'to'],
    },
    async preview({ from, to }) { return { title: 'Drag on simulated desktop', summary: `(${from.x}, ${from.y}) → (${to.x}, ${to.y})` }; },
    async execute({ from, to, steps = 12 }, ctx) {
      const id = openTabId(ctx);
      ctx.browser.sendInputEvent(id, { type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
        const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
        ctx.browser.sendInputEvent(id, { type: 'mouseMove', x, y });
      }
      ctx.browser.sendInputEvent(id, { type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      return { ok: true, from, to };
    },
  },
  {
    name: 'computer.hotkey', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.interact',
    description: 'Send a keyboard shortcut with modifiers, e.g. keys: ["control","c"] for Ctrl+C, ["control","shift","z"] for redo. The last key in the list is the "main" key; the rest are held as modifiers.',
    inputSchema: {
      type: 'object',
      properties: { keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', maxLength: 20 } } },
      required: ['keys'],
    },
    async preview({ keys }) { return { title: 'Send keyboard shortcut', summary: keys.join('+') }; },
    async execute({ keys }, ctx) {
      const id = openTabId(ctx);
      const mainKey = keys[keys.length - 1];
      const modifiers = keys.slice(0, -1).map((k) => k.toLowerCase());
      ctx.browser.sendInputEvent(id, { type: 'keyDown', keyCode: mainKey, modifiers });
      ctx.browser.sendInputEvent(id, { type: 'keyUp', keyCode: mainKey, modifiers });
      return { ok: true, keys };
    },
  },
  {
    name: 'computer.clipboard_read', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.clipboard',
    description: 'Read the current system clipboard text. Sensitive: the clipboard may hold something the user copied for other reasons (passwords, personal info).',
    inputSchema: { type: 'object', properties: {} },
    async preview() { return { title: 'Read system clipboard' }; },
    async execute() { const { clipboard } = require('electron'); return { text: clipboard.readText() }; },
  },
  {
    name: 'computer.clipboard_write', group: 'computer', permission: LEVEL.SENSITIVE, category: 'computer.clipboard',
    description: 'Write text to the system clipboard (e.g. so the user, or a computer.hotkey Ctrl+V, can paste it).',
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 20000 } }, required: ['text'] },
    async preview({ text }) { return { title: 'Write to system clipboard', summary: truncate(text, 200) }; },
    async execute({ text }) { const { clipboard } = require('electron'); clipboard.writeText(text); return { ok: true }; },
  },
  {
    name: 'computer.find', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Search the current computer.observe results for elements whose text contains a substring (case-insensitive) — a shortcut for scanning the full observe list yourself.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] },
    async execute({ text }, ctx) {
      const { elements, url, title } = await ctx.browser.runScript(openTabId(ctx), OBSERVE_SCRIPT);
      const needle = text.toLowerCase();
      const matches = elements.filter((e) => (e.text || '').toLowerCase().includes(needle));
      return { url, title, matches };
    },
  },
  {
    name: 'computer.wait_for_text', group: 'computer', permission: LEVEL.NONE, category: 'none',
    description: 'Poll the simulated desktop until its visible text contains a given substring, or time out. Use after an action whose result takes a moment to appear.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 200 }, timeout_ms: { type: 'integer', minimum: 500, maximum: 30000 }, interval_ms: { type: 'integer', minimum: 100, maximum: 5000 } },
      required: ['text'],
    },
    async execute({ text, timeout_ms = 10000, interval_ms = 500 }, ctx) {
      const id = openTabId(ctx);
      const needle = text.toLowerCase();
      const deadline = Date.now() + timeout_ms;
      for (;;) {
        const { text: pageText } = await ctx.browser.runScript(id, GET_TEXT_SCRIPT);
        if (pageText.toLowerCase().includes(needle)) return { found: true, waited_ms: timeout_ms - Math.max(0, deadline - Date.now()) };
        if (Date.now() >= deadline) return { found: false, timed_out: true };
        await new Promise((resolve) => setTimeout(resolve, interval_ms));
      }
    },
  },
];
