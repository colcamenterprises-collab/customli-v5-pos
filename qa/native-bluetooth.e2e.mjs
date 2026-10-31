import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
const cwd=process.cwd(),data=mkdtempSync(path.join(tmpdir(),'v5-native-bt-')),password='v5-native-qa-password';
const portServer=http.createServer();await new Promise(ok=>portServer.listen(0,'127.0.0.1',ok));const port=portServer.address().port;await new Promise(ok=>portServer.close(ok));
const api=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:String(port),V5_API_PREFIX:'/v5/api',V5_DATA_DIR:data,V5_BOOTSTRAP_PASSWORD:password,V5_DEMO_SEED:'1',V5_PRINT_KDS_DB:''},stdio:'ignore'});
const app=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/v5/api/')){const chunks=[];for await(const c of req)chunks.push(c);const response=await fetch('http://127.0.0.1:'+port+req.url,{method:req.method,headers:{...Object.fromEntries(Object.entries(req.headers).filter(([key])=>!['host','origin'].includes(key)))},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([k])=>!['content-encoding','transfer-encoding'].includes(k))));res.end(Buffer.from(await response.arrayBuffer()));return;}
  const rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\/v5\//,'')||'index.html',file=path.resolve('dist',rel);if(!file.startsWith(path.resolve('dist')+path.sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(readFileSync(file));
 }catch(e){res.writeHead(500);res.end(e.message)}
});
let browser;
try{
 let ready=false;for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:'+port+'/v5/api/health');ready=true;break}catch{await new Promise(ok=>setTimeout(ok,70))}}assert(ready);
 const db=new DatabaseSync(path.join(data,'pos.sqlite'));db.prepare("UPDATE users SET role='Owner' WHERE username='manager'").run();db.close();
 await new Promise(ok=>app.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+app.address().port+'/v5/';
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:1024,height:768}});
 await ctx.addInitScript(()=>{
  const calls=[];window.__bluetoothCalls=calls;
  window.Capacitor={isNativePlatform:()=>true,Plugins:{ThermalPrinter:{
    scanPrinters:async()=>({printers:[{name:'Printer ABC',address:'AA:BB:CC:DD:EE:FF',bonded:true}]}),
    listPrinters:async()=>({printers:[{name:'Printer ABC',address:'AA:BB:CC:DD:EE:FF',bonded:true}]}),
    connect:async({address})=>{calls.push('connect:'+address);return {connected:true}},
    disconnect:async()=>{calls.push('disconnect');return {connected:false}},
    printTest:async()=>{calls.push('test');return {ok:true}},
    printRaw:async()=>({ok:true})
  }}};
 });
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByLabel('Username').fill('manager');await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Bluetooth printer'}).waitFor({timeout:10000});
 await page.getByRole('button',{name:'Bluetooth printer'}).click();
 const dialog=page.getByRole('dialog',{name:'Bluetooth printer'});await dialog.waitFor();
 await dialog.getByText('Printer ABC').first().waitFor();
 await dialog.getByRole('button',{name:/Printer ABC/}).click();
 await dialog.getByRole('button',{name:'Connect & save'}).click();
 await dialog.getByText('Printer saved.').waitFor();
 await dialog.getByRole('button',{name:'Test print'}).click();
 await dialog.getByText('Test sent. Check').waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('customli.v5.bluetooth.printer')).width),80);
 assert.deepEqual(await page.evaluate(()=>window.__bluetoothCalls),['connect:AA:BB:CC:DD:EE:FF','disconnect','connect:AA:BB:CC:DD:EE:FF','test','disconnect']);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log('PASS Android mocked UI: find → select → connect & save → test → release socket; 390px responsive, no page errors');
}finally{
 await browser?.close();await new Promise(ok=>app.close(ok));api.kill();await new Promise(ok=>api.once('exit',ok));rmSync(data,{recursive:true,force:true});
}
