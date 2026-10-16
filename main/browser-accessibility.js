'use strict';
   
                                                                          
                                                                          
                                                                              
                                                                        
                                                                          
                                                                      
                  
  
                                                                     
                                                                        
                                                                         
                                                                    
   

const INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [onclick], [tabindex]:not([tabindex="-1"])';
const MAX_ELEMENTS = 150;
const MAX_TEXT = 120;

                                                                                                                        
const OBSERVE_SCRIPT = `(() => {
  const SEL = ${JSON.stringify(INTERACTIVE_SELECTOR)};
  const MAX = ${MAX_ELEMENTS};
  const MAXTEXT = ${MAX_TEXT};
  window.__akhtar = [];
  const out = [];
  const nodes = Array.from(document.querySelectorAll(SEL));
  for (const el of nodes) {
    if (out.length >= MAX) break;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const id = window.__akhtar.length;
    window.__akhtar.push(el);
    let label = '';
    try {
      const aria = el.getAttribute('aria-label');
      if (aria) label = aria.trim();
      else if ('value' in el && el.value && el.tagName !== 'TEXTAREA') label = String(el.value).slice(0, 80);
      else {
        const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
        if (text) label = text;
        else {
          const ph = el.getAttribute('placeholder');
          if (ph) label = '(placeholder: ' + ph + ')';
        }
      }
    } catch (e) { label = ''; }
    out.push({
      id, tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      role: el.getAttribute('role') || null,
      text: label.slice(0, MAXTEXT),
      href: el.tagName === 'A' ? el.getAttribute('href') : undefined,
      disabled: !!el.disabled,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    });
  }
  return { url: location.href, title: document.title, elements: out };
})()`;

const GET_TEXT_SCRIPT = `(() => {
  const MAX = 15000;
  const text = (document.body ? document.body.innerText : '') || '';
  return { url: location.href, title: document.title, text: text.length > MAX ? text.slice(0, MAX) + '\\n… [truncated]' : text };
})()`;

const GET_LINKS_SCRIPT = `(() => {
  const MAX = 200;
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const text = (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    out.push({ text, href });
    if (out.length >= MAX) break;
  }
  return { url: location.href, links: out };
})()`;

function buildClickScript(id) {
  return `(() => {
    const el = window.__akhtar && window.__akhtar[${JSON.stringify(id)}];
    if (!el) return { ok: false, error: 'Element ' + ${JSON.stringify(id)} + ' not found. Call browser.observe again — the page may have changed.' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus?.();
    el.click();
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`;
}

function buildDoubleClickScript(id) {
  return `(() => {
    const el = window.__akhtar && window.__akhtar[${JSON.stringify(id)}];
    if (!el) return { ok: false, error: 'Element ' + ${JSON.stringify(id)} + ' not found. Call observe again.' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('dblclick', opts));
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`;
}

function buildRightClickScript(id) {
  return `(() => {
    const el = window.__akhtar && window.__akhtar[${JSON.stringify(id)}];
    if (!el) return { ok: false, error: 'Element ' + ${JSON.stringify(id)} + ' not found. Call observe again.' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, button: 2, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('contextmenu', opts));
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`;
}

function buildHoverScript(id) {
  return `(() => {
    const el = window.__akhtar && window.__akhtar[${JSON.stringify(id)}];
    if (!el) return { ok: false, error: 'Element ' + ${JSON.stringify(id)} + ' not found. Call observe again.' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`;
}

function buildGetValueScript(id) {
  return `(() => {
    const el = window.__akhtar && window.__akhtar[${JSON.stringify(id)}];
    if (!el) return { ok: false, error: 'Element ' + ${JSON.stringify(id)} + ' not found. Call observe again.' };
    const value = 'value' in el ? el.value : undefined;
    const text = (el.innerText || el.textContent || '').trim();
    const checked = 'checked' in el ? el.checked : undefined;
    return { ok: true, value, text, checked, disabled: !!el.disabled };
  })()`;
}

function buildTypeScript(id, text, submit) {
  return `(() => {
    const el = window.__akhtar && window.__akhtar[${JSON.stringify(id)}];
    if (!el) return { ok: false, error: 'Element ' + ${JSON.stringify(id)} + ' not found. Call browser.observe again — the page may have changed.' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus?.();
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (${JSON.stringify(!!submit)}) {
      const form = el.closest('form');
      if (form && form.requestSubmit) form.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { ok: true };
  })()`;
}

function buildScrollScript(direction, amount) {
  const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
  const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  return `(() => { window.scrollBy(${dx}, ${dy}); return { ok: true, scrollY: window.scrollY, scrollX: window.scrollX }; })()`;
}

module.exports = { OBSERVE_SCRIPT, GET_TEXT_SCRIPT, GET_LINKS_SCRIPT, buildClickScript, buildDoubleClickScript, buildRightClickScript, buildHoverScript, buildGetValueScript, buildTypeScript, buildScrollScript };
