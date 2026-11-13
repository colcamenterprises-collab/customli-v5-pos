// Real packaged POS + IndexedDB. Transport is simulated; no device/hardware claim.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
const root=path.resolve('android-dist');
const server=http.createServer((req,res)=>{try{const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/'))throw Error();const bytes=readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(bytes)}catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let online=true,dropSale=true;const attempts=[];
 await page.addInitScript(()=>{sessionStorage.setItem('customli-platform-session','isolated-device-token');sessionStorage.setItem('customli-device-id','test-pos');sessionStorage.setItem('customli-location-id','test-location')});
 await page.route('https://customli.io/v5/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname.slice('/v5/api'.length);if(!online)return route.abort('failed');let value=[];
  if(p==='/me')value={id:'device:test-pos',username:'Counter',role:'Cashier',device:{id:'test-pos',mode:'POS',locationId:'test-location'}};
  if(p==='/products')value=[{id:'burger',name:'Test Burger',category:'Burgers',price:10000,active:1,available:1}];
  if(p==='/categories')value=[{id:'burgers',name:'Burgers',active:1}];
  if(p==='/shift')value={shift:{id:'original-shift',opening_cash:0,opened_at:new Date().toISOString()}};
  if(p==='/sales-channels')value=[{id:'in-store',name:'Direct',kind:'direct',active:1}];
  if(p==='/sales-channels/prices')value={prices:[]};
  if(p==='/display/revision')value={revision:0};
  if(p==='/display')value={ok:true};
  if(p==='/orders'&&req.method()==='POST'){
   const body=req.postDataJSON();attempts.push(body);if(dropSale)return route.abort('failed');value={id:'recorded-order',receipt_number:99,subtotal:10000,total:10000,discount_total:0,items:[{id:'line',name:'Test Burger',price:10000,quantity:1}],payment_method:'Cash'};
  }
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/pos/index.html`);await page.getByText('Test Burger',{exact:true}).waitFor();await page.getByRole('button',{name:'Add to cart',exact:false}).click();await page.getByPlaceholder('Cash received (THB)').fill('100');await page.getByRole('button',{name:'Complete Cash Sale',exact:true}).click();
 await page.getByText(/Payment is saved on this tablet/).waitFor();assert.equal(attempts.length,1);const original=attempts[0];assert.equal(original.expectedShiftId,'original-shift');assert.equal(original.expectedTotalMinor,10000);
 online=false;await page.reload();await page.getByText('Test Burger',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Shift Open',exact:true}).count(),1,'Complete cached configuration loads offline');
 await page.getByRole('button',{name:'Saved payments',exact:true}).click();await page.getByRole('heading',{name:'Saved payments',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Review with manager',exact:true}).count(),1);await page.getByRole('button',{name:'Done',exact:true}).click();
 online=true;dropSale=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByText(/Saved payment synchronized. Receipt #99/).waitFor();assert.equal(attempts.length,2);assert.equal(attempts[1].idempotencyKey,original.idempotencyKey);assert.equal(attempts[1].expectedShiftId,'original-shift');
 await page.getByRole('button',{name:'Saved payments',exact:true}).click();await page.getByText('All saved payments are synchronized.').waitFor();assert.deepEqual(errors,[]);
 console.log('PASS packaged POS: cash intent survives interrupted send/reload; full offline menu/shift/prices load; original key/shift preserved; recovery acknowledged once');
}finally{await browser.close();await new Promise(r=>server.close(r))}
