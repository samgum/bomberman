import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build,transform } from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist');
const owner='samgum/bomberman-classic';
const source=['index.html','manifest.webmanifest','_headers','sw.js','package.json','package-lock.json','scripts/build.mjs','vendor/jsnes/jsnes.min.js','vendor/jsnes/package.json','vendor/jsnes/LICENSE','game/bomberman.nes','assets/FONT-LICENSE.txt'];
for(const directory of ['app','assets'])for(const name of await fs.readdir(path.join(root,directory)))if(/\.(js|css|svg|png|woff2)$/.test(name))source.push(directory+'/'+name);
source.sort();
const inputs=new Map();
const versionHash=createHash('sha256');
for(const name of source) {
  const data=await fs.readFile(path.join(root,name));
  inputs.set(name,data);
  versionHash.update(name).update(data);
}
const version=versionHash.digest('hex').slice(0,16);
const bundleName='assets/game-'+version+'.js';
const styleName='assets/style-'+version+'.css';
const bundle=await build({entryPoints:[path.join(root,'app/main.js')],bundle:true,format:'esm',platform:'browser',target:['safari15','chrome90'],minify:true,write:false,legalComments:'none',outfile:path.join(output,bundleName)});
const style=await transform(inputs.get('app/style.css').toString(),{loader:'css',minify:true,target:['safari15','chrome90']});
const published=new Map();
for(const [name,data] of inputs)if(name.startsWith('assets/') || ['manifest.webmanifest','vendor/jsnes/LICENSE','game/bomberman.nes'].includes(name))published.set(name,data);
published.set(bundleName,Buffer.from(bundle.outputFiles[0].contents));
published.set(styleName,Buffer.from(style.code));
let html=inputs.get('index.html').toString().replace('src="app/main.js"','src="'+bundleName+'"').replace('href="app/style.css"','href="'+styleName+'"');
html=html.replace('</head>','  <link rel="preload" href="assets/ui-pixel.woff2" as="font" type="font/woff2" crossorigin>\n</head>');
published.set('index.html',Buffer.from(html));
published.set('sw.js',Buffer.from(inputs.get('sw.js').toString().replace('__BUILD_VERSION__',version)));
published.set('_headers',Buffer.from(inputs.get('_headers').toString()+'\n/'+bundleName+'\n  Cache-Control: public, max-age=31536000, immutable\n/'+styleName+'\n  Cache-Control: public, max-age=31536000, immutable\n/sw.js\n  Cache-Control: no-cache\n'));
const files=Array.from(published,([name,data])=>({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
try {
  const meta=JSON.parse(await fs.readFile(path.join(output,'build-meta.json'),'utf8'));
  if(meta.owner!==owner || path.resolve(output)!==path.resolve(root,'dist'))throw new Error('Refusing to replace an unknown build directory.');
  await fs.rm(output,{recursive:true,force:true});
} catch(error) {
  if(error.code!=='ENOENT')throw error;
  try {if((await fs.readdir(output)).length)throw new Error('Refusing to replace an unmarked directory.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
await fs.mkdir(output,{recursive:true});
for(const [name,data] of published){await fs.mkdir(path.dirname(path.join(output,name)),{recursive:true});await fs.writeFile(path.join(output,name),data);}
await fs.writeFile(path.join(output,'build-meta.json'),JSON.stringify({owner,version,hosting:'Cloudflare Pages',files},null,2)+'\n');
console.log(JSON.stringify({version,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)},null,2));
