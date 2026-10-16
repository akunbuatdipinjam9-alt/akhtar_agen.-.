'use strict';
   
                                              
  
                                                                      
                         
                                                      
                                                    
                                                             
  
                                                                                
                                                                              
                                                                                
   
const crypto = require('crypto');
const { OBSERVE_SCRIPT, GET_TEXT_SCRIPT, buildGetValueScript } = require('../main/browser-accessibility');

const TAB_NAME = 'computer-control';
const MUTATING = new Set([
  'computer.open', 'computer.close', 'computer.click', 'computer.type', 'computer.keypress',
  'computer.scroll', 'computer.double_click', 'computer.right_click', 'computer.hover',
  'computer.move_mouse', 'computer.click_at', 'computer.drag', 'computer.hotkey',
]);
const ID_TARGETED = new Set(['computer.click', 'computer.type', 'computer.double_click', 'computer.right_click', 'computer.hover']);

const hash = (value) => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value ?? null)).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function supportsBeforeAfter(toolName) { return MUTATING.has(toolName); }

function compactElements(elements = []) {
  return elements.slice(0, 120).map((e) => ({
    id: e.id, tag: e.tag, type: e.type || null, role: e.role || null,
    text: String(e.text || '').slice(0, 120), disabled: !!e.disabled,
    bounds: e.bounds || null,
  }));
}

async function captureComputerState(ctx, args = {}, toolName = '') {
  const id = ctx.browser?.named?.get(TAB_NAME);
  if (!id || !ctx.browser?.tabs?.has(id)) return { open: false };

  const tab = ctx.browser.list().find((t) => t.id === id) || {};
  let observed = { elements: [] }, text = { text: '' }, viewport = { x: 0, y: 0 }, screenshotHash = null, target = null;
  try { observed = await ctx.browser.runScript(id, OBSERVE_SCRIPT); } catch {}
  try { text = await ctx.browser.runScript(id, GET_TEXT_SCRIPT); } catch {}
  try { viewport = await ctx.browser.runScript(id, '({x:Math.round(window.scrollX||0),y:Math.round(window.scrollY||0)})'); } catch {}
  if (ID_TARGETED.has(toolName) && Number.isInteger(args.id)) {
    try { target = await ctx.browser.runScript(id, buildGetValueScript(args.id)); } catch {}
  }
  try { screenshotHash = hash(await ctx.browser.capturePng(id)); } catch {}

  const elements = compactElements(observed.elements || []);
  const visibleText = String(text.text || '').slice(0, 12000);
  return {
    open: true,
    url: observed.url || text.url || tab.url || null,
    title: observed.title || text.title || tab.title || null,
    textHash: hash(visibleText),
    domHash: hash(elements),
    screenshotHash,
    scroll: viewport,
    target,
    elementCount: elements.length,
  };
}

async function captureBefore(toolName, args, ctx) {
  if (!supportsBeforeAfter(toolName)) return null;
  return { tool: toolName, capturedAt: Date.now(), state: await captureComputerState(ctx, args, toolName) };
}

function changedSignals(before, after) {
  const signals = [];
  const b = before?.state || {}, a = after?.state || {};
  if (!!b.open !== !!a.open) signals.push('open_state');
  if (b.url !== a.url) signals.push('url');
  if (b.title !== a.title) signals.push('title');
  if (b.textHash !== a.textHash) signals.push('visible_text');
  if (b.domHash !== a.domHash) signals.push('interactive_dom');
  if (b.screenshotHash && a.screenshotHash && b.screenshotHash !== a.screenshotHash) signals.push('pixels');
  if ((b.scroll?.x ?? 0) !== (a.scroll?.x ?? 0) || (b.scroll?.y ?? 0) !== (a.scroll?.y ?? 0)) signals.push('scroll');
  if (JSON.stringify(b.target ?? null) !== JSON.stringify(a.target ?? null)) signals.push('target_value');
  return [...new Set(signals)];
}

function judge(toolName, args, before, after) {
  const signals = changedSignals(before, after);
  let confirmed = signals.length > 0;
  let reason = confirmed ? `Observed state change: ${signals.join(', ')}` : 'No visible state change was detected after the action.';

  if (toolName === 'computer.open') {
    confirmed = after?.state?.open === true;
    reason = confirmed ? 'Simulated desktop is open after the action.' : 'Simulated desktop did not become observable.';
  } else if (toolName === 'computer.close') {
    confirmed = before?.state?.open === false || after?.state?.open === false;
    reason = confirmed ? 'Simulated desktop is closed after the action.' : 'Simulated desktop still appears open.';
  } else if (toolName === 'computer.type' && !args?.submit) {
    const value = after?.state?.target?.value;
    if (typeof value === 'string') {
      confirmed = value === String(args.text ?? '');
      reason = confirmed ? 'Target input value matches the requested text.' : 'Target input value does not match the requested text.';
    }
  } else if (toolName === 'computer.scroll') {
    confirmed = signals.includes('scroll') || signals.includes('pixels');
    reason = confirmed ? 'Viewport movement was observed.' : 'Viewport did not visibly move.';
  } else if (toolName === 'computer.move_mouse' || toolName === 'computer.hover') {
                                                                                               
    confirmed = signals.length > 0;
    reason = confirmed ? `Pointer action produced an observable change: ${signals.join(', ')}` : 'Pointer action completed, but no stable visual change can be confirmed.';
  }

  return { ok: true, confirmed, signals, reason };
}

async function captureAfterAndVerify(toolName, args, ctx, before) {
  if (!before || !supportsBeforeAfter(toolName)) return null;
                                                                                          
  await sleep(toolName === 'computer.type' && args?.submit ? 300 : 140);
  const after = { tool: toolName, capturedAt: Date.now(), state: await captureComputerState(ctx, args, toolName) };
  const verdict = judge(toolName, args, before, after);
  return {
    ...verdict,
    checkedAt: Date.now(),
    before: before.state,
    after: after.state,
  };
}

module.exports = { supportsBeforeAfter, captureBefore, captureAfterAndVerify, judge, changedSignals };
