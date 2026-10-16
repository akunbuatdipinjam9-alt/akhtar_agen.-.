'use strict';

function esc(v) { return JSON.stringify(v); }

const GET_HTML_SCRIPT = `(() => {
  const MAX = 50000;
  const root = document.documentElement ? document.documentElement.cloneNode(true) : null;
  if (root) {
    for (const el of root.querySelectorAll('script')) el.textContent = '[SCRIPT REDACTED]';
    for (const el of root.querySelectorAll('input')) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const name = (el.getAttribute('name') || el.getAttribute('id') || '').toLowerCase();
      if (type === 'password' || type === 'hidden' || /(token|secret|password|passwd|auth|cookie|session|key)/i.test(name)) { if (el.hasAttribute('value')) el.setAttribute('value', '[REDACTED]'); }
    }
  }
  const html = root ? root.outerHTML : '';
  return { url: location.href, title: document.title, html: html.length > MAX ? html.slice(0, MAX) + '\n<!-- … truncated -->' : html, truncated: html.length > MAX, sanitized: true };
})()`;

const GET_METADATA_SCRIPT = `(() => {
  const meta = {};
  for (const el of document.querySelectorAll('meta')) {
    const key = el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('http-equiv');
    const value = el.getAttribute('content');
    if (key && value && Object.keys(meta).length < 100) meta[key] = value.slice(0, 1000);
  }
  const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
  const lang = document.documentElement?.lang || null;
  return { url: location.href, title: document.title, lang, canonical, meta };
})()`;

const GET_FORMS_SCRIPT = `(() => {
  const forms = [];
  const labelFor = (el) => {
    const id = el.id;
    if (id) {
      const lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (lab) return (lab.innerText || lab.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
    }
    const parent = el.closest('label');
    return parent ? (parent.innerText || parent.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160) : null;
  };
  for (const [index, form] of Array.from(document.forms).entries()) {
    const fields = [];
    for (const el of Array.from(form.elements).slice(0, 100)) {
      fields.push({
        name: el.name || null, id: el.id || null, tag: el.tagName?.toLowerCase() || null,
        type: el.type || null, label: labelFor(el), placeholder: el.placeholder || null,
        required: !!el.required, disabled: !!el.disabled,
        value: /password/i.test(el.type || '') ? '[REDACTED]' : (typeof el.value === 'string' ? el.value.slice(0, 500) : null),
        checked: typeof el.checked === 'boolean' ? el.checked : undefined,
      });
    }
    forms.push({ index, id: form.id || null, name: form.name || null, action: form.action || location.href, method: (form.method || 'get').toLowerCase(), fields });
    if (forms.length >= 25) break;
  }
  return { url: location.href, forms };
})()`;

const GET_TABLES_SCRIPT = `(() => {
  const tables = [];
  for (const [index, table] of Array.from(document.querySelectorAll('table')).entries()) {
    const rows = [];
    for (const tr of Array.from(table.querySelectorAll('tr')).slice(0, 100)) {
      const cells = Array.from(tr.querySelectorAll('th,td')).slice(0, 50).map(td => (td.innerText || td.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 1000));
      if (cells.length) rows.push(cells);
    }
    tables.push({ index, id: table.id || null, caption: table.querySelector('caption')?.innerText?.trim() || null, rows });
    if (tables.length >= 20) break;
  }
  return { url: location.href, tables };
})()`;

const GET_IMAGES_SCRIPT = `(() => ({
  url: location.href,
  images: Array.from(document.images).slice(0, 200).map((img, index) => ({ index, src: img.currentSrc || img.src || null, alt: img.alt || '', width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0, title: img.title || null }))
}))()`;

const GET_BUTTONS_SCRIPT = `(() => ({
  url: location.href,
  buttons: Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],[role="button"]')).slice(0, 200).map((el, index) => ({ index, tag: el.tagName.toLowerCase(), type: el.type || null, text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 200), disabled: !!el.disabled }))
}))()`;

const GET_INPUTS_SCRIPT = `(() => ({
  url: location.href,
  inputs: Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 250).map((el, index) => ({ index, tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: el.id || null, placeholder: el.placeholder || null, required: !!el.required, disabled: !!el.disabled, value: /password/i.test(el.type || '') ? '[REDACTED]' : (typeof el.value === 'string' ? el.value.slice(0, 500) : null), checked: typeof el.checked === 'boolean' ? el.checked : undefined }))
}))()`;

const GET_PAGE_STATE_SCRIPT = `(() => ({
  url: location.href,
  title: document.title,
  ready_state: document.readyState,
  visibility: document.visibilityState,
  scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY), maxY: Math.max(0, document.documentElement.scrollHeight - innerHeight) },
  viewport: { width: innerWidth, height: innerHeight },
  document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
  counts: { links: document.links.length, forms: document.forms.length, images: document.images.length, inputs: document.querySelectorAll('input,textarea,select').length },
  active_element: document.activeElement ? { tag: document.activeElement.tagName?.toLowerCase(), id: document.activeElement.id || null, name: document.activeElement.getAttribute?.('name') || null } : null
}))()`;

function buildElementInfoScript(selector, id) {
  return `(() => {
    let el = null;
    if (${id === undefined ? 'false' : 'true'}) el = window.__akhtar && window.__akhtar[${esc(id)}];
    if (!el && ${selector ? 'true' : 'false'}) { try { el = document.querySelector(${esc(selector || '')}); } catch (e) { return { ok:false, error:'Invalid selector: ' + e.message }; } }
    if (!el) return { ok:false, error:'Element not found.' };
    const r = el.getBoundingClientRect();
    const attrs = {}; for (const a of Array.from(el.attributes || []).slice(0, 50)) attrs[a.name] = a.value.slice(0,500);
    return { ok:true, tag:el.tagName.toLowerCase(), text:(el.innerText||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,2000), value:/password/i.test(el.type||'')?'[REDACTED]':('value' in el?String(el.value).slice(0,1000):undefined), checked:'checked' in el?!!el.checked:undefined, disabled:!!el.disabled, attributes:attrs, bounds:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)} };
  })()`;
}

function buildSelectOptionScript(selector, id, value, label) {
  return `(() => {
    let el = null;
    if (${id === undefined ? 'false' : 'true'}) el = window.__akhtar && window.__akhtar[${esc(id)}];
    if (!el && ${selector ? 'true' : 'false'}) { try { el = document.querySelector(${esc(selector || '')}); } catch(e){ return {ok:false,error:'Invalid selector: '+e.message}; } }
    if (!el || el.tagName !== 'SELECT') return {ok:false,error:'Select element not found.'};
    let option = null;
    if (${value !== undefined ? 'true' : 'false'}) option = Array.from(el.options).find(o => o.value === ${esc(value)});
    if (!option && ${label !== undefined ? 'true' : 'false'}) option = Array.from(el.options).find(o => (o.textContent||'').trim() === ${esc(label)});
    if (!option) return {ok:false,error:'Option not found.'};
    el.value = option.value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    return {ok:true,value:el.value,label:(option.textContent||'').trim()};
  })()`;
}

function buildCheckScript(selector, id, checked) {
  return `(() => {
    let el = null;
    if (${id === undefined ? 'false' : 'true'}) el = window.__akhtar && window.__akhtar[${esc(id)}];
    if (!el && ${selector ? 'true' : 'false'}) { try { el = document.querySelector(${esc(selector || '')}); } catch(e){ return {ok:false,error:'Invalid selector: '+e.message}; } }
    if (!el || !('checked' in el)) return {ok:false,error:'Checkable element not found.'};
    const want = ${checked === undefined ? '!el.checked' : esc(!!checked)};
    if (el.checked !== want) el.click();
    if (el.checked !== want) { el.checked = want; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
    return {ok:true,checked:!!el.checked};
  })()`;
}

function buildFillFormScript(fields, submit) {
  return `(() => {
    const spec = ${esc(fields)};
    const changed = []; const missing = [];
    const all = Array.from(document.querySelectorAll('input,textarea,select'));
    const norm = s => String(s||'').trim().toLowerCase();
    const labelText = el => { const id=el.id; if(id){const l=document.querySelector('label[for="'+CSS.escape(id)+'"]'); if(l)return norm(l.innerText||l.textContent);} const p=el.closest('label'); return p?norm(p.innerText||p.textContent):''; };
    const find = key => all.find(el => el.name===key || el.id===key) || all.find(el => norm(el.getAttribute('aria-label'))===norm(key) || norm(el.placeholder)===norm(key) || labelText(el)===norm(key));
    for (const [key, raw] of Object.entries(spec)) {
      const el = find(key); if(!el){ missing.push(key); continue; }
      if (el.tagName === 'SELECT') {
        const val = String(raw); const opt = Array.from(el.options).find(o => o.value===val || norm(o.textContent)===norm(val));
        if (!opt) { missing.push(key + ':option'); continue; } el.value=opt.value;
      } else if ((el.type||'').toLowerCase()==='checkbox' || (el.type||'').toLowerCase()==='radio') {
        const want = !!raw; if (el.checked !== want) el.click(); if(el.checked!==want) el.checked=want;
      } else {
        const val = raw == null ? '' : String(raw); const proto = el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set; if(setter)setter.call(el,val); else el.value=val;
      }
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); changed.push(key);
    }
    let submitted=false;
    if (${esc(!!submit)}) { const form = (changed.length && find(changed[0])?.closest('form')) || document.querySelector('form'); if(form){ if(form.requestSubmit)form.requestSubmit(); else form.submit(); submitted=true; } }
    return {ok:true,changed,missing,submitted};
  })()`;
}

function buildWaitForScript(selector, text) {
  return `(() => {
    try {
      const selector = ${esc(selector || '')}; const wanted = ${esc(text || '')}.toLowerCase();
      let el = selector ? document.querySelector(selector) : null;
      if (!el && wanted) el = Array.from(document.querySelectorAll('body *')).find(x => ((x.innerText||x.textContent||'').trim().toLowerCase()).includes(wanted));
      if (!selector && !wanted) return {found:true,url:location.href,title:document.title};
      if (!el) return {found:false}; const r=el.getBoundingClientRect();
      return {found:true,tag:el.tagName.toLowerCase(),text:(el.innerText||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,500),visible:r.width>0&&r.height>0};
    } catch(e){ return {found:false,error:e.message}; }
  })()`;
}

function buildExtractDataScript(selectors) {
  return `(() => {
    const spec = ${esc(selectors)}; const data = {};
    for (const [key, selector] of Object.entries(spec)) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector)).slice(0,100);
        data[key] = nodes.map(el => ({ text:(el.innerText||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,2000), href:el.href||undefined, src:el.currentSrc||el.src||undefined, value:/password/i.test(el.type||'')?'[REDACTED]':('value' in el?String(el.value).slice(0,1000):undefined) }));
      } catch(e){ data[key] = { error:'Invalid selector: '+e.message }; }
    }
    return {url:location.href,data};
  })()`;
}

module.exports = { GET_HTML_SCRIPT, GET_METADATA_SCRIPT, GET_FORMS_SCRIPT, GET_TABLES_SCRIPT, GET_IMAGES_SCRIPT, GET_BUTTONS_SCRIPT, GET_INPUTS_SCRIPT, GET_PAGE_STATE_SCRIPT, buildElementInfoScript, buildSelectOptionScript, buildCheckScript, buildFillFormScript, buildWaitForScript, buildExtractDataScript };
