import {voiceBusy,voicePendingSaves} from './voice.js';
const host=document.createElement('aside');host.className='app-availability';host.setAttribute('aria-label','App availability');
const status=document.createElement('p');status.setAttribute('role','status');
const install=document.createElement('button');install.textContent='Install Witness';install.hidden=true;
const update=document.createElement('button');update.textContent='Reload to update';update.hidden=true;
const help=document.createElement('details');help.innerHTML='<summary>Use as an app</summary><p>In Chrome, use Install Witness when available. On iPhone or iPad, open Witness in Safari, then Share → Add to Home Screen. Your stories stay in this browser; installation does not sync them to another device.</p>';
host.append(status,install,update,help);document.body.append(host);
let ready=false,prompt=null,waiting=null;
function connection(){status.textContent=!navigator.onLine?'Offline. You can read, write and record here. Meta tools need a connection.':ready?'Available offline on this device.':'';status.hidden=!status.textContent;}
connection();window.addEventListener('online',connection);window.addEventListener('offline',connection);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;install.hidden=false;});
window.addEventListener('appinstalled',()=>{prompt=null;install.hidden=true;});
install.addEventListener('click',async()=>{if(!prompt)return;const choice=prompt;prompt=null;install.hidden=true;await choice.prompt();await choice.userChoice;});
update.addEventListener('click',()=>{
 if(document.querySelector('[data-action=backup-current]')){status.hidden=false;status.textContent='Download this tab’s draft or reload the saved version before updating.';return;}
 if(voiceBusy()||voicePendingSaves()){status.hidden=false;status.textContent='Finish recording or saving your audio before updating.';return;}
 if(waiting){waiting.postMessage({type:'WITNESS_ACTIVATE'});}
});
if('serviceWorker' in navigator&&window.isSecureContext){
 let reloadRequested=false;
 update.addEventListener('click',()=>{if(waiting&&!voiceBusy()&&!voicePendingSaves()&&!document.querySelector('[data-action=backup-current]'))reloadRequested=true;});
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloadRequested)window.location.reload();});
 navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{
  const offer=()=>{if(reg.waiting&&navigator.serviceWorker.controller){waiting=reg.waiting;update.hidden=false;}};
  offer();reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',offer);});
  navigator.serviceWorker.ready.then(()=>{ready=true;connection();});
 }).catch(()=>{status.hidden=false;status.textContent='Offline setup was unavailable. Your saved stories are still on this device.';});
}
