const fs = require('fs');
const body = new FormData();
body.append('complaint', JSON.stringify({ title: 'Issue', description: 'A blocked drain near the school needs attention.', category: 'Drainage', location: 'North Street', contact: 'test@example.com' }));
body.append('photos', new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,10,0,0,0,10,8,6,0,0,0,0,0,0,0,0,0,0,0,0,73,69,78,68,174,66,96,130])], 'first.png', { type: 'image/png' }));
const raw = Buffer.from(new Response(body).arrayBuffer());
console.log('content-type', body.headers.get('content-type'));
console.log('raw length', raw.length);
const contentType = body.headers.get('content-type') || '';
const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
const boundary = (match[1] || match[2]).trim();
const marker = Buffer.from(`--${boundary}`);
const sections = [];
let start = 0;
while (start < raw.length) {
  const index = raw.indexOf(marker, start);
  if (index === -1) break;
  const sectionStart = index + marker.length;
  const nextIndex = raw.indexOf(marker, sectionStart);
  if (nextIndex === -1) break;
  const section = raw.subarray(sectionStart, nextIndex);
  sections.push(section);
  start = nextIndex + marker.length;
}
console.log('sections', sections.length);
for (const [i, section] of sections.entries()) {
  const contentStart = section.indexOf(Buffer.from('\r\n\r\n'));
  const headersText = section.subarray(0, contentStart).toString('latin1');
  const content = section.subarray(contentStart + 4);
  const trimmed = content.subarray(0, Math.max(0, content.length - 2));
  const disposition = /name="([^"]+)"(?:;\s*filename="([^"]+)")?/i.exec(headersText);
  console.log('section', i, 'headers', JSON.stringify(headersText));
  console.log('field', disposition && disposition[1], 'file', disposition && disposition[2], 'len', trimmed.length, 'preview', trimmed.slice(0, 30).toString('latin1'));
}
