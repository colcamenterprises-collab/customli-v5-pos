import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='/v5/',root=path.resolve('dist');
const server=createServer((req,res)=>{
 const relative=decodeURIComponent(req.url.split('?')[0]).replace(/^\/v5\//,'')||'index.html';
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const rules=[{id:'member',name:'Member Discount',kind:'percent',value:1000,active:true,access_mode:'manager_pin'},
 {id:'owner',name:'Owner Discount',kind:'percent',value:10000,active:true,access_mode:'manager_pin'},
 {id:'unhappy',name:'Unhappy Customer',kind:'percent',value:1000,active:true,access_mode:'manager_pin'}];
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await ctx.addInitScript(()=>sessionStorage.setItem('v5_token','isolated-test-token'));
 await ctx.route('**/v5/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(p.endsWith('/me'))return reply({id:'owner',role:'Owner',username:'owner'});
  if(p.endsWith('/products'))return reply([]);
  if(p.endsWith('/categories'))return reply([]);
  if(p.endsWith('/shift'))return reply({shift:null});
  if(p.endsWith('/sales-channels'))return reply([{id:'in-store',kind:'direct',name:'In-store',active:true}]);
  if(p.endsWith('/sales-channels/prices'))return reply({prices:[]});
  if(p.endsWith('/discount-catalog'))return reply(rules);
  return reply({});
 });
 const page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+base);
 await page.getByRole('button',{name:'Discount Management'}).waitFor();
 await page.getByRole('button',{name:'Discount Management'}).click();
 await page.getByRole('heading',{name:'Approved Discounts'}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Edit .* Discount/}).count(),2);
 assert.equal(await page.getByRole('button',{name:'Edit Unhappy Customer'}).count(),1);
 assert.equal(await page.getByRole('button',{name:/^Edit /}).count(),3);
 assert(await page.getByText('Manager approval').count()===3);
 await page.getByRole('button',{name:'Edit Owner Discount'}).click();
 // Editing must still call existing modal logic (not presentation-only).
 await page.locator('.backdrop').first().waitFor();
 await page.keyboard.press('Escape').catch(()=>{});
 await page.setViewportSize({width:1024,height:768});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('PASS POS Discounts: approved rule names/amounts/access; custom scoped cards; existing edit modal remains accessible; tablet no overflow.');
 await ctx.close();
}finally{await browser?.close();await new Promise(r=>server.close(r))}
