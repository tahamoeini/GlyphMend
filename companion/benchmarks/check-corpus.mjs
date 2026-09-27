import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)),'corpus');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const expected = ['text-heavy','scanned-english','multi-column','table','equation','image-heavy'];
const failures=[];
if(manifest.documents?.length!==expected.length) failures.push('manifest must contain exactly the six required document classes');
for(const category of expected){
  const rows=manifest.documents.filter((row)=>row.documentClass===category);
  if(rows.length!==1) failures.push(`${category}: expected exactly one labeled document`);
}
for(const row of manifest.documents){
  const file=path.join(root,row.file);
  if(!fs.existsSync(file)){failures.push(`${row.id}: missing ${row.file}`);continue;}
  const bytes=fs.readFileSync(file);
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==row.sha256) failures.push(`${row.id}: fixture checksum mismatch`);
  if(bytes.subarray(0,5).toString()!=='%PDF-') failures.push(`${row.id}: not a PDF file`);
  if(!Array.isArray(row.text)||!row.text.length||!Array.isArray(row.structure)||!row.structure.length) failures.push(`${row.id}: gold text and structure labels are required`);
  if(!row.labelSource?.includes('before any extractor run')) failures.push(`${row.id}: labels must be declared independent of extractor output`);
}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`Corpus verified: ${manifest.documents.length} checksummed PDFs across ${expected.join(', ')}.`);
