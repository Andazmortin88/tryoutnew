import {readFile,readdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {base} from './site-metadata.mjs';
import {PREMIUM_PLANS} from '../app-src/plans.js';
const root=path.resolve(new URL('../dist/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const files=(await readdir(root)).filter(n=>n.endsWith('.html'));
assert.equal(files.length,14);
let graphs=0;
for(const name of files){
 const html=await readFile(path.join(root,name),'utf8');
 assert(html.includes('favicon-192.png'),name+' favicon missing');
 assert(html.includes('rel="canonical"'),name+' canonical missing');
 assert(!/20 soal gratis|trial 20 soal/i.test(html),name+' stale trial copy');
 assert(!html.includes('ukom-health-pro-62cqKDbR.png'),name+' unstable social image');
 const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
 for(const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){
  const data=JSON.parse(m[1]);graphs++;
  assert(csp?.includes("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"),name+' CSP hash mismatch');
  const org=data['@graph']?.find(x=>x['@type']==='Organization');assert(org?.logo?.url===base+'logo.png',name+' logo graph missing');
 }
 for(const m of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const href=m[1];if(/^(?:https?:|mailto:|tel:|data:|#)/.test(href))continue;
  const clean=href.split(/[?#]/)[0];if(!clean||clean==='./')continue;
  await access(path.join(root,clean.replace(/^\//,''))).catch(()=>{throw Error(name+' missing local asset '+href)});
 }
}
assert.equal(graphs,10);
const index=await readFile(path.join(root,'index.html'),'utf8');assert(index.includes('"@type":"WebSite"'));assert(index.includes('"@type":"Organization"'));assert(index.includes('"@type":"Service"'));
const packages=await readFile(path.join(root,'paket-ukom.html'),'utf8');
for(const p of PREMIUM_PLANS)assert(packages.includes('"price":"'+p.price+'"'));
const sitemap=await readFile(path.join(root,'sitemap.xml'),'utf8');
for(const slug of ['paket-ukom.html','tentang-ukom-health-pro.html'])assert(sitemap.includes(base+slug));
for(const [name,size] of [['favicon-48.png',48],['favicon-192.png',192],['apple-touch-icon.png',180],['logo.png',512]]){
 const b=await readFile(path.join(root,name));assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);
}
const ico=await readFile(path.join(root,'favicon.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
console.log('SEO:14 pages,10 schema graphs,CSP hashes,local assets,4 offers,sitemap,and brand image sizes passed');
