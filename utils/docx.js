'use strict';
   
                                                                         
                                                                            
                                                                           
                                                                             
                                                  
   
const { buildZip } = require('./zip');

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

                                              
function inlineRuns(text) {
  const runs = [];
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  parts.forEach((part, i) => { if (part) runs.push({ text: part, bold: i % 2 === 1 }); });
  return runs.length ? runs : [{ text: '', bold: false }];
}

function runXml({ text, bold }) {
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraphXml(line) {
  if (line.trim() === '') return '<w:p/>';

  const heading = line.match(/^(#{1,3})\s+(.*)/);
  if (heading) {
    const level = heading[1].length;
    const size = level === 1 ? 32 : level === 2 ? 28 : 24;               
    const spacingBefore = level === 1 ? 360 : 240;
    return `<w:p><w:pPr><w:spacing w:before="${spacingBefore}" w:after="120"/></w:pPr>` +
      `<w:r><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(heading[2])}</w:t></w:r></w:p>`;
  }

  const bullet = line.match(/^[-*]\s+(.*)/);
  if (bullet) {
    const runs = inlineRuns(bullet[1]).map(runXml).join('');
    return `<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">• </w:t></w:r>${runs}</w:p>`;
  }

  const runs = inlineRuns(line).map(runXml).join('');
  return `<w:p>${runs}</w:p>`;
}

function bodyXml(title, content) {
  const titlePara = `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>`;
  const bodyParas = String(content).replace(/\r\n/g, '\n').split('\n').map(paragraphXml).join('');
  const sectPr = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${titlePara}${bodyParas}${sectPr}</w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

function coreXml(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title)}</dc:title>
<dc:creator>Akhtar Agent</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

                                                                  
function textToDocx(title, content) {
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(coreXml(title), 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(bodyXml(title, content), 'utf8') },
  ]);
}

module.exports = { textToDocx };
