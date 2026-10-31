#!/usr/bin/env node
// Run on the computer/gateway physically attached to the printer, never on the VPS.
import net from 'node:net';
import {open,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const command=process.argv[2],directory=process.env.CUSTOMLI_PRINT_HOME||path.join(os.homedir(),'.customli-print'),configFile=path.join(directory,'config.json');
await mkdir(directory,{recursive:true,mode:0o700});
const save=async(file,data)=>writeFile(file,JSON.stringify(data,null,2),{mode:0o600});
if(command==='discover'){
 const devices=[];for(const dir of ['/dev/serial/by-id','/dev/usb'])try{for(const name of await readdir(dir))devices.push({name,transport:'usb',target:path.join(dir,name)})}catch{}
 for(const name of await readdir('/dev').catch(()=>[]))if(/^rfcomm\d+$/.test(name))devices.push({name,transport:'bluetooth',target:'/dev/'+name});
 console.log(JSON.stringify({devices,note:'Network printers: use the address on the printer network report. Bluetooth printers must be paired with this operating system.'},null,2));process.exit(0);
}
if(command==='pair'){
 const api=process.env.CUSTOMLI_PRINT_API,code=process.env.CUSTOMLI_PAIR_CODE,target=process.env.CUSTOMLI_PRINTER_TARGET;
 if(!api?.startsWith('https://')||!code||!target)throw Error('Set CUSTOMLI_PRINT_API, CUSTOMLI_PAIR_CODE and CUSTOMLI_PRINTER_TARGET.');
 const response=await fetch(api.replace(/\/$/,'')+'/print-agent/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await response.json();if(!response.ok)throw Error(data.message);await save(configFile,{api:api.replace(/\/$/,''),target,...data});console.log('Printer paired. Start with: node print-gateway.mjs run');process.exit(0);
}
if(command!=='run')throw Error('Choose discover, pair or run.');
const config=JSON.parse(await readFile(configFile,'utf8')),session=randomUUID(),targetHash=createHash('sha256').update(config.target).digest('hex'),lock=path.join(os.tmpdir(),'customli-printer-'+targetHash+'.lock');
// An exclusive OS lock directory prevents two gateways on the same host controlling one device.
try{await mkdir(lock,{mode:0o700});await writeFile(path.join(lock,'pid'),String(process.pid));}catch{let alive=true;try{process.kill(Number(await readFile(path.join(lock,'pid'),'utf8')),0)}catch{alive=false;}if(alive)throw Error('Another gateway owns this printer.');await rm(lock,{recursive:true});await mkdir(lock,{mode:0o700});await writeFile(path.join(lock,'pid'),String(process.pid));}
let stopped=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;});
async function api(route,body){const r=await fetch(config.api+'/print-agent'+route,{method:'POST',headers:{Authorization:'Bearer '+config.token,'X-Print-Session':session,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw Error(data.message);return data;}
async function transmit(bytes,profile){
 if(profile.transport==='network')return new Promise((resolve,reject)=>{const [host,portString]=config.target.split(':'),port=Number(portString||9100);if(!host||!Number.isInteger(port)||port<1||port>65535)return reject(Object.assign(Error('Invalid printer address'),{bytesSent:false}));let started=false;const socket=net.createConnection({host,port});socket.setTimeout(10000);socket.on('timeout',()=>socket.destroy(Error('Printer timed out')));socket.on('error',e=>reject(Object.assign(e,{bytesSent:started})));socket.on('connect',()=>{started=true;socket.end(bytes,()=>resolve());});});
 if(!config.target.startsWith('/dev/'))throw Object.assign(Error('Choose an operating system printer device.'),{bytesSent:false});
 let handle,started=false;try{handle=await open(config.target,'w');started=true;await handle.writeFile(bytes);}catch(e){e.bytesSent=started;throw e;}finally{await handle?.close();}
}
try{while(!stopped){try{
 await api('/heartbeat',{});const {job,attention}=await api('/claim',{});if(attention)console.log(attention);
 if(job){const ledger=path.join(directory,job.id+'.json');let previous=null;try{previous=JSON.parse(await readFile(ledger,'utf8'))}catch{}
 if(previous){await api('/jobs/'+job.id+'/complete',{lease:job.lease,status:'uncertain',error:'A previous local attempt exists. Check the paper.'});}
 else{await save(ledger,{jobId:job.id,hash:job.hash,state:'write-started',at:new Date().toISOString()});let result;
 try{await transmit(Buffer.from(job.bytes,'base64'),job.profile);result={status:'sent',evidence:'transport-write'};}catch(e){result={status:e.bytesSent===false?'failed':'uncertain',bytesSent:e.bytesSent===false?false:undefined,error:e.message};}
 await save(ledger,{jobId:job.id,hash:job.hash,...result,at:new Date().toISOString()});await api('/jobs/'+job.id+'/complete',{lease:job.lease,...result});if(result.status==='failed')await rm(ledger,{force:true});
 }}
 }catch(e){console.error(e.message);}if(!stopped)await new Promise(r=>setTimeout(r,3000));}
}finally{await rm(lock,{recursive:true,force:true});}
