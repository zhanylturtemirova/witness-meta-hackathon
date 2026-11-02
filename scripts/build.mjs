import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as esbuild from 'esbuild';
// Vendor the official Supabase SDK as a browser ESM bundle, built straight
// into dist/ so web/ is never mutated by the build. It is loaded lazily
// (dynamic import on explicit Account action) so the guest flow never
// fetches it; including it in the static shell keeps Account working offline
// after setup. Only this generated file is exposed, nothing else.
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('web','dist',{recursive:true});
await esbuild.build({
 entryPoints:['node_modules/@supabase/supabase-js/dist/index.mjs'],
 bundle:true,format:'esm',platform:'browser',minify:true,
 outfile:'dist/vendor/supabase.js',
});
async function filesAt(dir){
 const entries=await readdir(dir,{withFileTypes:true});
 const nested=await Promise.all(entries.map(e=>e.isDirectory()?filesAt(dir+'/'+e.name):dir+'/'+e.name));
 return nested.flat();
}
// All executable modules, fonts and icons; large Earth textures cache after use.
const files=(await filesAt('dist')).filter(p=>p!=='dist/sw.js'&&/\.(html|js|css|svg|woff2?|png|webmanifest)$/.test(p)).map(p=>'./'+p.slice(5)).sort();
const hash=createHash('sha256');
for(const file of files)hash.update(file).update(await readFile('dist/'+file.slice(2)));
hash.update(await readFile('dist/sw.js'));
// Runtime texture changes must invalidate their cache as well.
for(const file of ['earth-day.jpg','earth-night.jpg'])hash.update(await readFile('dist/assets/earth/'+file));
const version=hash.digest('hex').slice(0,16);
const sw=(await readFile('dist/sw.js','utf8')).replace("/* WITNESS_BUILD */ {version:'development',files:[]}",JSON.stringify({version,files}));
await writeFile('dist/sw.js',sw);
console.log('Built Witness in dist/ (offline shell '+version+')');
