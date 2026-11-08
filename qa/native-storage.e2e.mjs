import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const source=readFileSync(new URL('../native-storage.mjs',import.meta.url),'utf8');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/storage.mjs'?'text/javascript':'text/html');res.end(req.url==='/storage.mjs'?source:'<!doctype html><title>Isolated durability test</title>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(async()=>{sessionStorage.setItem('customli-device-id','one');sessionStorage.setItem('customli-location-id','location');const s=await import('/storage.mjs');await s.cachePut('/products',[{id:'burger'}]);await s.prepareCommand({idempotencyKey:'stable',paymentMethod:'Cash',approval:{managerId:'manager',pin:'123456'},items:[{productId:'burger',quantity:1}]})});
 await page.reload();await page.evaluate(async()=>{await (await import('/storage.mjs')).markCommandAttention('stable','Session ended')});
 const restored=await page.evaluate(async()=>{const s=await import('/storage.mjs');let changed=false,second=false;try{await s.prepareCommand({idempotencyKey:'stable',items:[]})}catch{changed=true}try{await s.prepareCommand({idempotencyKey:'another',items:[]})}catch{second=true}return {pending:await s.pendingCommands(),cache:await s.cacheGet('/products'),changed,second}});
 assert.equal(restored.pending[0].state,'needs_attention');assert.equal(restored.pending.length,1);assert.equal(restored.pending[0].requiresApproval,true);assert.equal(restored.pending[0].body.approval,undefined);assert(!JSON.stringify(restored.pending).includes('123456'));assert.equal(restored.pending[0].body.idempotencyKey,'stable');assert.equal(restored.cache.value[0].id,'burger');assert.equal(restored.changed,true);assert.equal(restored.second,true);
 assert.equal(await page.evaluate(async()=>{sessionStorage.setItem('customli-device-id','two');return (await (await import('/storage.mjs')).pendingCommands()).length}),0);
 await page.evaluate(async()=>{sessionStorage.setItem('customli-device-id','one');await (await import('/storage.mjs')).resolveCommand('stable',{reason:'Manager resolved rejected request'})});await page.reload();assert.equal(await page.evaluate(async()=>(await (await import('/storage.mjs')).pendingCommands()).length),0);
 console.log('PASS real IndexedDB: reload durability, stable payment key, changed/second command rejection, device isolation, durable acknowledgement');
}finally{await browser.close();await new Promise(r=>server.close(r))}
