import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('web','dist',{recursive:true});
async function filesAt(dir){
 const entries=await readdir(dir,{withFileTypes:true});
 const nested=await Promise.all(entries.map(e=>e.isDirectory()?filesAt(dir+'/'+e.name):dir+'/'+e.name));
 return nested.flat();
}
// All executable modules, fonts and icons; large Earth textures cache after use.
const files=(await filesAt('web')).filter(p=>p!=='web/sw.js'&&/\.(html|js|css|svg|woff2?|png|webmanifest)$/.test(p)).map(p=>'./'+p.slice(4)).sort();
const hash=createHash('sha256');
for(const file of files)hash.update(file).update(await readFile('web/'+file.slice(2)));
hash.update(await readFile('web/sw.js'));
// Runtime texture changes must invalidate their cache as well.
for(const file of ['earth-day.jpg','earth-night.jpg'])hash.update(await readFile('web/assets/earth/'+file));
const version=hash.digest('hex').slice(0,16);
const sw=(await readFile('web/sw.js','utf8')).replace("/* WITNESS_BUILD */ {version:'development',files:[]}",JSON.stringify({version,files}));
await writeFile('dist/sw.js',sw);
console.log('Built Witness in dist/ (offline shell '+version+')');
