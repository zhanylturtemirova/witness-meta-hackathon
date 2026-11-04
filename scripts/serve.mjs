if(!process.env.WITNESS_NO_BUILD)await import('./build.mjs');
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {existsSync} from 'node:fs';
import {handleSpeech} from '../server/transcribe.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {apiRequestUrl,serverListen,healthBody} from '../server/config.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');
const root = path.resolve('dist');
const types = {'.webmanifest':'application/manifest+json','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://'+req.headers.host);
    if(url.pathname==='/health'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(healthBody(process.env)));return;
    }
    if(url.pathname.startsWith('/api/')){
      const apiUrl=apiRequestUrl(req.url,req.headers.host,process.env);
      if(!apiUrl){res.writeHead(403);res.end();return;}
      const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort();});
      const request=new Request(apiUrl,{method:req.method,headers:req.headers,signal:abort.signal,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
      const response=await handleAI(request,process.env) || await handleSpeech(request,process.env);
      if(res.writableEnded||res.destroyed)return;
      if(response){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
      res.writeHead(404);res.end();return;
    }
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'}); res.end(body);
  } catch { if(!res.writableEnded&&!res.destroyed){ try{res.writeHead(404);res.end('Not found');}catch{} } }
});
const listen=serverListen(process.env);
server.listen(listen.port, listen.host, () => console.log(`Witness (${listen.hosted?'hosted':'local'}) on port ${listen.port}`));
