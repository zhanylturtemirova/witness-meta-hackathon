import {spawn} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const envPath=path.join(root,'.env');
if(existsSync(envPath))process.loadEnvFile(envPath);
const apiKey=process.env.META_API_KEY||process.env.MODEL_API_KEY;
if(!apiKey?.trim()){console.error('Add MODEL_API_KEY to your local .env before starting Muse Code.');process.exit(1);}
const local=path.join(homedir(),'muse-bin','muse');
const stateHome=path.join(root,'.muse-local','state');
mkdirSync(stateHome,{recursive:true,mode:0o700});
const dataHome=path.join(root,'.muse-local','data');
mkdirSync(dataHome,{recursive:true,mode:0o700});
const child=spawn(existsSync(local)?local:'muse',process.argv.slice(2),{cwd:root,stdio:'inherit',env:{...process.env,META_API_KEY:apiKey,XDG_STATE_HOME:stateHome,XDG_DATA_HOME:dataHome}});
child.on('error',()=>{console.error('Muse Code could not start. Check that muse is installed.');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
