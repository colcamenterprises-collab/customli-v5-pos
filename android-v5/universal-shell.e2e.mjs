// Browser integration checks use a fake native bridge; they are not hardware acceptance.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
const root=path.resolve(import.meta.dirname,'../android-dist');
const server=http.createServer((req,res)=>{try{const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(route==='/'?'/index.html':route));if(!file.startsWith(root+path.sep))throw Error();const data=readFileSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
const lease=new Date(Date.now()+3600000).toISOString();
const device={id:'device-one',tenantId:'tenant-one',locationId:'location-one',name:'Counter',mode:'CDS',posDeviceId:'pos-one',station:'Expo',offlineUntil:lease};
async function scenario({mode='CDS',network=false,status=200,expired=false,stale=false,registered=true}={}){
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.addInitScript(({device,mode,network,status,expired,stale,registered})=>{
  if(window!==window.top)return;
  let record=registered?{token:'secret-device-token',device:{...device,mode,offlineUntil:expired?'2020-01-01T00:00:00Z':device.offlineUntil}}:null;
  window.__nativeRecord=()=>record;
  window.Capacitor={isNativePlatform:()=>true,Plugins:{DeviceIdentity:{read:async()=>({installationId:'11111111-1111-4111-8111-111111111111',...(record?{credential:JSON.stringify(record)}:{})}),save:async({credential})=>{record=JSON.parse(credential);},clear:async()=>{record=null;}},CapacitorHttp:{request:async({url,method,data})=>{
   const p=new URL(url).pathname;
   if(p.endsWith('/devices/self')){if(network)throw Error('Offline');return{status,data:status===200?{...record.device}:{message:'Device revoked'}};}
   if(p.endsWith('/devices/peers'))return{status:200,data:[]};
   if(p.endsWith('/locations'))return{status:200,data:[{id:'location-one',tenantId:'tenant-one',name:'Rawai'}]};
   if(p.endsWith('/devices'))return{status:200,data:[{id:'pos-one',name:'Front counter',mode:'POS',locationId:'location-one',tenantId:'tenant-one'}]};
   if(p.endsWith('/login'))return{status:200,data:{token:'account-session'}};
   if(p.endsWith('/devices/register'))return{status:200,data:{token:'new-device-token',device:{...device,mode:data.mode,posDeviceId:data.posDeviceId}}};
   if(p.endsWith('/display'))return{status:200,data:{items:[{name:'Double Burger',quantity:2,unitPrice:15000}],subtotal:30000,discount:3000,total:27000,state:'recorded',branding:{name:'Smash Brothers Burgers'},stale}};
   return{status:200,data:{...device,mode}};
  }}}};
 },{device,mode,network,status,expired,stale,registered});
 // Reused KDS requests are actual fetch from the local iframe.
 await context.route('https://customli.io/v5-kds/**',route=>{const url=route.request().url();return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.includes('/api/me')?{id:'device-one',station:'Expo',label:'Expo'}:[])});});
 const page=await context.newPage();await page.goto(base);return{context,page};
}
try{
 let test=await scenario();await test.page.getByRole('heading',{name:'Smash Brothers Burgers'}).waitFor();await test.page.getByText('Double Burger',{exact:false}).waitFor();assert.match(await test.page.locator('body').innerText(),/270/);assert.match(await test.page.locator('body').innerText(),/order has been recorded/);assert.equal(await test.page.getByRole('button').count(),0);await test.context.close();
 test=await scenario({stale:true});await test.page.getByRole('heading',{name:'Reconnecting'}).waitFor();assert.equal(await test.page.getByText('Double Burger',{exact:false}).count(),0);await test.context.close();
 test=await scenario({status:401});await test.page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();assert.equal(await test.page.evaluate(()=>window.__nativeRecord()),null);await test.context.close();
 test=await scenario({mode:'POS',network:true});await test.page.locator('iframe[title="Point of sale"]').waitFor();assert.equal(await test.page.evaluate(()=>sessionStorage.getItem('customli-device-id')),'device-one');assert.equal(await test.page.evaluate(()=>sessionStorage.getItem('customli-location-id')),'location-one');await test.context.close();
 test=await scenario({mode:'POS',network:true,expired:true});await test.page.getByRole('heading',{name:'Connect to continue'}).waitFor();assert.equal(await test.page.locator('iframe').count(),0);await test.context.close();
 test=await scenario({mode:'KDS'});await test.page.frameLocator('iframe').getByRole('heading',{name:'Order assembly'}).waitFor();assert.equal(await test.page.frameLocator('iframe').getByText('Pair kitchen display').count(),0);await test.context.close();
 test=await scenario({registered:false});await test.page.getByLabel('Email').fill('owner@example.com');await test.page.getByLabel('Password').fill('Example123');await test.page.getByRole('button',{name:'Continue',exact:true}).click();await test.page.getByRole('heading',{name:'Set up this device'}).waitFor();await test.page.getByLabel('Device name').fill('Customer display');await test.page.getByRole('combobox',{name:'Use this device for'}).click();await test.page.getByRole('option',{name:'Customer display'}).click();await test.page.getByRole('combobox',{name:'POS device'}).waitFor();assert.equal(await test.page.locator('input[name="posDeviceId"]').count(),0);await test.page.getByRole('button',{name:'Save device'}).click();await test.page.getByRole('heading',{name:'Smash Brothers Burgers'}).waitFor();assert.equal((await test.page.evaluate(()=>window.__nativeRecord())).device.posDeviceId,'pos-one');await test.context.close();
 console.log('PASS: 7 universal shell browser scenarios (native bridge mocked; no physical acceptance)');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
