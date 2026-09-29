import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, 'corpus');
const glyphs = {
  A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','11001','10101','10011','10011','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
  0:['01110','10001','10011','10101','11001','10001','01110'],1:['00100','01100','00100','00100','00100','00100','01110'],2:['01110','10001','00001','00010','00100','01000','11111'],3:['11110','00001','00001','01110','00001','00001','11110'],4:['00010','00110','01010','10010','11111','00010','00010'],5:['11111','10000','10000','11110','00001','00001','11110'],6:['01110','10000','10000','11110','10001','10001','01110'],7:['11111','00001','00010','00100','01000','01000','01000'],8:['01110','10001','10001','01110','10001','10001','01110'],9:['01110','10001','10001','01111','00001','00001','01110'],'.':['00000','00000','00000','00000','00000','00110','00110'],',':['00000','00000','00000','00000','00110','00110','00100'],':':['00000','00110','00110','00000','00110','00110','00000'],'-':['00000','00000','00000','11111','00000','00000','00000'],
};

function pdf({ content, images = [] }) {
  const objects = [];
  const add = (value) => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'binary')); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const imageRefs = images.map((_, index) => ` /Im${index} ${6 + index} 0 R`).join('');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject <<${imageRefs} >> >> /Contents 5 0 R >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const stream = Buffer.from(content, 'binary');
  add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
  for (const image of images) {
    const packed = deflateSync(image.pixels);
    add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`), packed, Buffer.from('\nendstream')]));
  }
  const chunks = [Buffer.from('%PDF-1.4\n% GlyphMend synthetic benchmark fixture\n')];
  const offsets = [0];
  for (let i=0;i<objects.length;i++) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${i+1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n'));
  }
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`));
  for (const offset of offsets.slice(1)) chunks.push(Buffer.from(`${String(offset).padStart(10,'0')} 00000 n \n`));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

function textContent(rows, { fontSize = 11, leading = 18 } = {}) {
  return rows.map(({ text, x = 48, y }, index) => `BT /F1 ${fontSize} Tf 1 0 0 1 ${x} ${y ?? (744-index*leading)} Tm (${text.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')}) Tj ET`).join('\n');
}

function scannedImage(lines) {
  const width = 1200, height = 1600, scale = 6;
  const pixels = Buffer.alloc(width*height, 255);
  lines.forEach((line, lineIndex) => {
    let x = 90, top = 200 + lineIndex*240;
    for (const char of line) {
      if (char === ' ') { x += 6*scale; continue; }
      const rows = glyphs[char];
      if (!rows) throw new Error(`No benchmark glyph for ${char}`);
      rows.forEach((row, gy) => [...row].forEach((bit, gx) => {
        if (bit !== '1') return;
        for (let dy=0;dy<scale;dy++) for (let dx=0;dx<scale;dx++) pixels[(top+gy*scale+dy)*width+x+gx*scale+dx] = 0;
      }));
      x += 6*scale;
    }
  });
  return { width, height, pixels };
}

function pattern(width, height, seed) {
  const pixels = Buffer.alloc(width*height, 250);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const grid = (x%24<2 || y%24<2) ? 70 : 0;
    const wave = ((x*13+y*7+seed*31)%71<7) ? 115 : 0;
    pixels[y*width+x] = Math.max(35, 250-grid-wave);
  }
  return { width, height, pixels };
}

const definitions = [
  { id:'text-heavy', documentClass:'text-heavy', text:['GLYPHMEND TEXT HEAVY BENCHMARK','A measured extraction begins with stable source text.','Each sentence has a clear baseline and reading order.','Page geometry places every line inside the margin.','Repeated terms let reviewers compare character error.','A second paragraph tests extraction across line breaks.','Reliable output preserves headings, words, and order.','The browser and companion receive the same PDF bytes.','No remote assets or private source documents are used.','This final line closes the synthetic text sample.'], structure:['heading','paragraph','paragraph'] },
  { id:'scanned-english', documentClass:'scanned-english', text:['GLYPHMEND OCR BENCHMARK','SCANNED ENGLISH SAMPLE','GROUND TRUTH LINE THREE','ORDER MUST STAY TOP TO BOTTOM'], structure:['image-page','four-lines'] },
  { id:'multi-column', documentClass:'multi-column', text:['LEFT COLUMN FIRST','Left column line two','Left column line three','Left column line four','RIGHT COLUMN SECOND','Right column line two','Right column line three','Right column line four'], structure:['two-columns','four-lines-each'] },
  { id:'table', documentClass:'table', text:['ITEM','COUNT','TOTAL','PAGES','3','12','MODEL','2','8','SUM','5','20'], structure:['table','three-rows','three-columns'] },
  { id:'equation', documentClass:'equation', text:['ENERGY RELATION','E = m c ^ 2','VARIABLES: E ENERGY, M MASS, C LIGHT SPEED'], structure:['heading','display-equation','caption'] },
  { id:'image-heavy', documentClass:'image-heavy', text:['IMAGE EVIDENCE SAMPLE','Figure A','Figure B','Figure C'], structure:['three-raster-figures','three-captions'] },
];

const contentById = {
  'text-heavy': () => textContent(definitions[0].text.map((text,index)=>({text,x:48,y:744-index*54})), {fontSize:12}),
  'scanned-english': () => 'q 540 0 0 720 36 36 cm /Im0 Do Q',
  'multi-column': () => textContent([
    ...definitions[2].text.slice(0,4).map((text,index)=>({text,x:54,y:730-index*42})),
    ...definitions[2].text.slice(4).map((text,index)=>({text,x:330,y:730-index*42})),
  ], {fontSize:13}),
  'table': () => {
    const rows = definitions[3].text;
    const cells = [48,270,390];
    let graphics = '0.8 w 42 620 m 530 620 l S 42 580 m 530 580 l S 42 540 m 530 540 l S 42 500 m 530 500 l S 42 460 m 530 460 l S 42 460 m 42 620 l S 260 460 m 260 620 l S 380 460 m 380 620 l S 530 460 m 530 620 l S\n';
    rows.forEach((text,index)=> { const row=Math.floor(index/3), col=index%3; graphics += textContent([{text,x:cells[col],y:594-row*40}],{fontSize:12})+'\n'; });
    return graphics;
  },
  'equation': () => textContent([
    {text:'ENERGY RELATION',x:58,y:700},
    {text:'E = m c ^ 2',x:205,y:555},
    {text:'VARIABLES: E ENERGY, M MASS, C LIGHT SPEED',x:80,y:400},
  ],{fontSize:18}),
  'image-heavy': () => textContent([
    {text:'IMAGE EVIDENCE SAMPLE',x:48,y:744},
    {text:'Figure A',x:48,y:504},{text:'Figure B',x:230,y:504},{text:'Figure C',x:412,y:504},
  ],{fontSize:12})+'\nq 160 0 0 150 40 330 cm /Im0 Do Q\nq 160 0 0 150 226 330 cm /Im1 Do Q\nq 160 0 0 150 412 330 cm /Im2 Do Q',
};

fs.mkdirSync(output,{recursive:true});
const labels=[];
for (const definition of definitions) {
  const images = definition.id === 'scanned-english' ? [scannedImage(definition.text)] : definition.id === 'image-heavy' ? [pattern(360,240,1),pattern(360,240,2),pattern(360,240,3)] : [];
  const bytes = pdf({content:contentById[definition.id](),images});
  const filename = `${definition.id}.pdf`;
  fs.writeFileSync(path.join(output,filename),bytes);
  labels.push({...definition,file:filename,sha256:createHash('sha256').update(bytes).digest('hex'),pages:1,labelSource:'hand-authored from the synthetic source definition before any extractor run'});
}
fs.writeFileSync(path.join(output,'manifest.json'),`${JSON.stringify({schemaVersion:1,corpus:'glyphmend-companion-initial',license:'CC0-1.0; synthetic content generated by generate-corpus.mjs',createdBy:'GlyphMend project contributors',documents:labels},null,2)}\n`);
console.log(`Generated ${labels.length} labeled PDF fixtures in ${output}`);
