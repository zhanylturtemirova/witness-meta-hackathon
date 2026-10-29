import './build.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {existsSync} from 'node:fs';
import {handleSpeech} from '../server/transcribe.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');
const root = path.resolve('dist');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://'+req.headers.host);
    if(url.pathname.startsWith('/api/')){
      if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){res.writeHead(403);res.end();return;}
      const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
      const response=await handleSpeech(request,process.env);
      if(response){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
      res.writeHead(404);res.end();return;
    }
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'}); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + server.address().port));
