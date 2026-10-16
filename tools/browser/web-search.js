'use strict';
                                                                                                 
function decodeEntities(input = '') {
  return String(input).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (_m, entity) => {
    const e = entity.toLowerCase();
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }[e] || _m;
  });
}
function readable(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function validatedLink(raw) {
  try {
    let href = decodeEntities(raw);
    if (href.startsWith('//')) href = `https:${href}`;
    const url = new URL(href);
    if (url.hostname === 'duckduckgo.com' && url.pathname.startsWith('/l/')) {
      href = url.searchParams.get('uddg') || href;
    }
    const target = new URL(href);
    if (!['https:', 'http:'].includes(target.protocol)) return null;
                                                                               
    return target.toString();
  } catch { return null; }
}
function uniqueResults(results, max = 10) {
  const seen = new Set();
  return results.filter((item) => {
    if (!item?.title || !item?.url || seen.has(item.url)) return false;
    seen.add(item.url); return true;
  }).slice(0, max);
}
function parseBingRss(xml) {
  const results = [];
  for (const match of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const get = (name) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '';
    const title = readable(get('title'));
    const url = validatedLink(readable(get('link')));
    const snippet = readable(get('description'));
    if (title && url) results.push({ title, url, snippet });
  }
  return uniqueResults(results);
}
function parseDuckDuckGoHtml(html) {
  const results = [];
  const src = String(html);
  const linkRE = /<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bresult__a\b[^"']*["'])([^>]*)>([\s\S]*?)<\/a>/gi;
  const links = [...src.matchAll(linkRE)];
  for (let i = 0; i < links.length; i++) {
    const attrs = links[i][1];
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = validatedLink(href);
    const title = readable(links[i][2]);
    if (!url || !title) continue;
    const after = src.slice(links[i].index + links[i][0].length, links[i + 1]?.index ?? src.length);
    const snippet = after.match(/<(?:a|div)\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'])[^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] || '';
    results.push({ title, url, snippet: readable(snippet) });
  }
  return uniqueResults(results);
}
module.exports = { decodeEntities, readable, parseBingRss, parseDuckDuckGoHtml };
