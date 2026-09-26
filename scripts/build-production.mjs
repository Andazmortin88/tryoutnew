import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transformSync } from '@babel/core';
import presetReact from '@babel/preset-react';

const root=process.cwd();
const sourcePath=path.join(root,'index.html');
const html=fs.readFileSync(sourcePath,'utf8');
const dist=path.join(root,'dist');
const assets=path.join(dist,'assets');
fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(assets,{recursive:true});

const jsxMatch=html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if(!jsxMatch) throw new Error('Inline JSX source not found');
const styleMatch=html.match(/<style>([\s\S]*?)<\/style>/);
if(!styleMatch) throw new Error('Custom style block not found');

const transformed=transformSync(jsxMatch[1],{
  presets:[[presetReact,{runtime:'classic'}]],
  comments:false,
  compact:false,
  sourceMaps:false
});
fs.writeFileSync(path.join(assets,'app.js'),transformed.code,'utf8');

const inputCss=path.join(root,'.build-tailwind.css');
fs.writeFileSync(inputCss,'@tailwind base;\n@tailwind components;\n@tailwind utilities;\n'+styleMatch[1],'utf8');
execFileSync(process.platform==='win32'?'npx.cmd':'npx',[
  'tailwindcss','-c','tailwind.config.cjs','-i',inputCss,'-o',path.join(assets,'app.css'),'--minify'
],{stdio:'inherit'});
fs.rmSync(inputCss,{force:true});

const copy=(src,dst)=>fs.copyFileSync(path.join(root,src),path.join(assets,dst));
copy('node_modules/react/umd/react.production.min.js','react.production.min.js');
copy('node_modules/react-dom/umd/react-dom.production.min.js','react-dom.production.min.js');

const supabaseCandidates=[
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'node_modules/@supabase/supabase-js/dist/umd/supabase.min.js'
];
const supabaseSrc=supabaseCandidates.find(p=>fs.existsSync(path.join(root,p)));
if(!supabaseSrc) throw new Error('Supabase UMD build not found');
copy(supabaseSrc,'supabase.js');

let out=html;
out=out.replace(/<script src="https:\/\/unpkg\.com\/react[^"]+"[^>]*><\/script>\s*/,'');
out=out.replace(/<script src="https:\/\/unpkg\.com\/react-dom[^"]+"[^>]*><\/script>\s*/,'');
out=out.replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]+"[^>]*><\/script>\s*/,'');
out=out.replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*><\/script>\s*/,'');
out=out.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"[^>]*><\/script>\s*/,'');
out=out.replace(/<script>tailwind\.config=[\s\S]*?<\/script>\s*/,'');
out=out.replace(styleMatch[0],'<link rel="stylesheet" href="./assets/app.css"/>');
out=out.replace(jsxMatch[0],[
  '<script src="./assets/react.production.min.js" defer></script>',
  '<script src="./assets/react-dom.production.min.js" defer></script>',
  '<script src="./assets/supabase.js" defer></script>',
  '<script src="./assets/app.js" defer></script>'
].join('\n'));

out=out.replace(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/,
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com data:; img-src \'self\' data: https:; connect-src \'self\' https://rnvmaihjaxpvsgnaczod.supabase.co wss://rnvmaihjaxpvsgnaczod.supabase.co; object-src \'none\'; base-uri \'self\'; form-action \'self\'; upgrade-insecure-requests"/>'
);

fs.writeFileSync(path.join(dist,'index.html'),out,'utf8');

for(const file of ['privacy.html','terms.html','refund.html','support.html']){
  const src=path.join(root,file);
  if(fs.existsSync(src)) fs.copyFileSync(src,path.join(dist,file));
}

// GitHub Pages disables Jekyll processing for deterministic static assets.
fs.writeFileSync(path.join(dist,'.nojekyll'),'','utf8');

const bad=[
  '@babel/standalone',
  'cdn.tailwindcss.com',
  'unpkg.com/react',
  'cdn.jsdelivr.net/npm/@supabase'
].filter(x=>out.includes(x));
if(bad.length) throw new Error('Runtime CDN dependency remained: '+bad.join(', '));
if(out.includes('unsafe-eval')) throw new Error('Production CSP still contains unsafe-eval');
console.log('Production build OK', {
  htmlBytes:Buffer.byteLength(out),
  jsBytes:fs.statSync(path.join(assets,'app.js')).size,
  cssBytes:fs.statSync(path.join(assets,'app.css')).size
});
