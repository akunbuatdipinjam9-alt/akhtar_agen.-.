'use strict';
   
                                                                          
                                                                    
                                                                       
                                     
   
const PAGE_W = 612, PAGE_H = 792;                     
const MARGIN = 54;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const CHAR_W = FONT_SIZE * 0.6;                                   

function escapePdfText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(line, maxChars) {
  if (line.length <= maxChars) return [line];
  const words = line.split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur.length) { cur = w; continue; }
    if ((cur + ' ' + w).length > maxChars) { out.push(cur); cur = w; }
    else cur += ' ' + w;
  }
  if (cur) out.push(cur);
                                                       
  return out.flatMap((l) => (l.length <= maxChars ? [l] : l.match(new RegExp(`.{1,${maxChars}}`, 'g'))));
}

                                                             
function paginate(text) {
  const maxChars = Math.floor((PAGE_W - 2 * MARGIN) / CHAR_W);
  const linesPerPage = Math.floor((PAGE_H - 2 * MARGIN) / LINE_HEIGHT);
  const rawLines = String(text).replace(/\r\n/g, '\n').split('\n');
  const wrapped = rawLines.flatMap((l) => (l.trim() === '' ? [''] : wrapLine(l, maxChars)));
  const pages = [];
  for (let i = 0; i < wrapped.length; i += linesPerPage) pages.push(wrapped.slice(i, i + linesPerPage));
  return pages.length ? pages : [['']];
}

function contentStreamFor(lines) {
  const top = PAGE_H - MARGIN;
  const body = lines.map((l) => `(${escapePdfText(l)}) Tj T*`).join('\n');
  return `BT\n/F1 ${FONT_SIZE} Tf\n${LINE_HEIGHT} TL\n${MARGIN} ${top} Td\n${body}\nET`;
}

                                                                                         
function textToPdf(title, text) {
  const full = title ? `${title}\n${'='.repeat(Math.min(title.length, 70))}\n\n${text}` : text;
  const pages = paginate(full);

  const objects = [];                                             
  const fontObjNum = 2 + pages.length + 1;                                                               
  const pagesObjNum = 2;

  objects[1] = `<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`;

  const pageObjNums = pages.map((_, i) => 3 + i);
  const contentObjNums = pages.map((_, i) => fontObjNum + 1 + i);

  objects[pagesObjNum] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  pages.forEach((_, i) => {
    objects[pageObjNums[i]] = `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`;
  });

  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;

  pages.forEach((lines, i) => {
    const stream = contentStreamFor(lines);
    objects[contentObjNums[i]] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  const total = objects.length;                              
  let out = '%PDF-1.4\n';
  const offsets = new Array(total).fill(0);
  for (let n = 1; n < total; n++) {
    offsets[n] = Buffer.byteLength(out, 'latin1');
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(out, 'latin1');
}

module.exports = { textToPdf };
