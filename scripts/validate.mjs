import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const site=join(root,'docs');
const corpus=JSON.parse(readFileSync(join(site,'data/corpus.json'),'utf8'));
assert.equal(corpus.questions.length,650);
assert.equal(new Set(corpus.questions.map(q=>q.id)).size,650);
assert.equal(corpus.questions.filter(q=>q.region==='大陆').length,577);
assert.equal(corpus.questions.filter(q=>q.region!=='大陆').length,73);
for(const q of corpus.questions) {
  for(const field of ['id','text','english','chinese','version']) assert.equal(typeof q[field],'string',q.id+' '+field);
  assert(q.text.trim() && q.english.trim() && q.chinese.trim(),q.id+' missing answer');
}
assert.equal(corpus.days.length,30);
assert.equal(corpus.days.filter(d=>d.kind==='review').length,4);
const scheduled=corpus.days.filter(d=>d.kind==='new').flatMap(d=>d.questionIds);
assert.equal(scheduled.length,577);
assert.equal(new Set(scheduled).size,577);
const known=new Set(corpus.questions.map(q=>q.id));
assert(scheduled.every(id=>known.has(id)));
const records=JSON.parse(readFileSync(join(site,'data/records.json'),'utf8'));
assert.equal(records.schemaVersion,1);
for(const key of ['events','entries','reviewSessions']) assert(Array.isArray(records[key]),key);
for(const item of [...records.events,...records.entries]) assert(known.has(item.questionId),item.questionId);
assert(!JSON.stringify(records).includes('user_id'),'Do not publish old account identifiers');
for(const f of ['index.html','assets/app.js','assets/style.css','assets/data.mjs','assets/audio-store.mjs','dot/index.html','dot-instructions.md','llms.txt','manifest.webmanifest','reminders.ics']) assert(existsSync(join(site,f)),f);
const allFiles=[];
function walk(dir){for(const name of readdirSync(dir)){const f=join(dir,name);statSync(f).isDirectory()?walk(f):allFiles.push(f);}}
walk(site);
for(const file of allFiles){
 assert(!/\.(?:webm|mp3|m4a|wav|pdf|env)$/i.test(file), 'Do not publish recordings, PDFs or environment files');
 if(!/\.(?:html|js|mjs|json|css|txt|md|svg|webmanifest)$/i.test(file))continue;
 const text=readFileSync(file,'utf8');
 assert(!/\b(?:ghp_|gho_|github_pat_|sk-proj-)[A-Za-z0-9_-]{15,}/.test(text),'Possible secret in '+file);
 assert(!/VAPID_PRIVATE|OPENAI_API_KEY\s*[:=]\s*['"][^'"]+['"]/.test(text),'Server configuration in '+file);
 assert(!text.includes('\ufffd'),'Invalid UTF-8 replacement in '+file);
 if(file.endsWith('.html'))for(const match of text.matchAll(/(?:href|src)=["']([^"']+)["']/g)){
  const href=match[1].replace(/&amp;/g,'&').split('#')[0].split('?')[0];
  if(!href||/^(?:https?:|mailto:|data:|blob:|\/)/.test(href))continue;
  assert(existsSync(resolve(dirname(file),decodeURIComponent(href))),'Broken local link '+file+': '+href);
 }
}
assert(readFileSync(join(site,'reminders.ics'),'utf8').includes('DTSTART:20261010T120000Z'));
console.log(JSON.stringify({questions:650,mainland:577,overseas:73,days:30,publishedEvents:records.events.length,publishedEntries:records.entries.length,staticFiles:allFiles.length,checks:'pass'},null,2));
