import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist');
const owner='samgum/bomberman-classic';
const source=['index.html','manifest.webmanifest','_headers','vendor/jsnes/jsnes.min.js','vendor/jsnes/LICENSE','game/bomberman.nes','assets/FONT-LICENSE.txt'];
for(const directory of ['app','assets'])for(const name of await fs.readdir(path.join(root,directory)))if(/\.(js|css|svg|png|woff2)$/.test(name))source.push(directory+'/'+name);
source.sort();
const files=[];
const versionHash=createHash('sha256');
for(const name of source) {
  const data=await fs.readFile(path.join(root,name));
  files.push({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
  versionHash.update(name).update(data);
}
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
for(const file of files){await fs.mkdir(path.dirname(path.join(output,file.path)),{recursive:true});await fs.copyFile(path.join(root,file.path),path.join(output,file.path));}
const version=versionHash.digest('hex').slice(0,16);
await fs.writeFile(path.join(output,'build-meta.json'),JSON.stringify({owner,version,hosting:'Cloudflare Pages',files},null,2)+'\n');
console.log(JSON.stringify({version,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)},null,2));
