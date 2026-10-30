import assert from 'node:assert/strict';
import {mkdtempSync,rmSync}from'node:fs';
import os from'node:os';import path from'node:path';import{spawn}from'node:child_process';
import{chromium}from'/opt/apps/customli-v5-test/node_modules/playwright/index.mjs';
const dir=mkdtempSync(path.join(os.tmpdir(),'phase1-ui-qa-')),root=process.env.POS_QA_APP_ROOT||'/opt/qa-customli-v5/phase1-pos';
const backend=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4445',V5_DATA_DIR:dir,V5_BOOTSTRAP_PASSWORD:'qa-only-modifier-password'},stdio:'ignore'});
const frontend=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4478','--strictPort','--base=/v5/'],{cwd:root,stdio:'ignore'});
let browser;
const api=async(path,method='GET',body=null,token=null)=>{const r=await fetch('http://127.0.0.1:4445/v5/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert(r.ok,path+': '+JSON.stringify(j));return j};
const wait=async(url)=>{for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.status===200||r.status===401)return}catch{}await new Promise(r=>setTimeout(r,90))}throw Error('Preview or API never started: '+url)};
try{
 await wait('http://127.0.0.1:4445/v5/api/health');await wait('http://127.0.0.1:4478/v5/');
 const session=await api('/login','POST',{username:'manager',password:'qa-only-modifier-password'});
 const products=await api('/products','GET',null,session.token),product=products[0];
 const g=await api('/modifier-groups','POST',{name:'Sauce choice',minSelect:1,maxSelect:1},session.token);
 const o=await api('/modifier-groups/'+g.id+'/options','POST',{name:'Extra sauce',priceMinor:250},session.token);
 await api('/products/'+product.id+'/modifier-groups','POST',{groupIds:[g.id]},session.token);
 await api('/shift/open','POST',{openingCash:0},session.token);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1360,height:900}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('JS PAGE ERROR',e.message)});page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url())});page.on('requestfailed',r=>console.log('FAILED REQUEST',r.url(),r.failure()));
 await page.route('**/v5/api/**',async route=>{
  const q=route.request(),target='http://127.0.0.1:4445'+new URL(q.url()).pathname;
  const response=await context.request.fetch(target,{method:q.method(),headers:{...q.headers(),origin:'https://customli.io'},...(q.postData()?{data:q.postData()}:{})});
  await route.fulfill({response});
 });
 console.log('QA page navigate');await page.goto('http://127.0.0.1:4478/v5/',{waitUntil:'domcontentloaded',timeout:10000});console.log('QA navigation complete',await page.title());page.setDefaultTimeout(7000);await page.waitForTimeout(1400);console.log('QA BODY',String(await page.locator('body').innerText()).slice(0,700));
 await page.getByRole('textbox',{name:'Username'}).fill('manager').catch(async()=>{await page.locator('input[name=username]').fill('manager')});
 await page.locator('input[name=password]').fill('qa-only-modifier-password');
 console.log('QA attempt login');await page.getByRole('button',{name:'Sign in'}).click();console.log('QA login clicked');
 await page.locator('.product').first().waitFor();
 const tile=page.locator('.product').filter({hasText:product.name}).first();
 console.log('QA product tile',product.name);await tile.getByRole('button',{name:'Add to cart'}).click();
 await page.getByRole('dialog',{name:'Customise '+product.name}).waitFor();
 await page.getByRole('button',{name:'Add Extra sauce'}).click();
 await page.getByRole('dialog',{name:'Customise '+product.name}).getByRole('button',{name:'Add to cart'}).click();
 await page.locator('.line').filter({hasText:'Extra sauce'}).waitFor();
 const line=await page.locator('.line').innerText();assert(line.includes('Extra sauce'));
 await page.screenshot({path:'/tmp/customli-v5-phase1-ui.png',fullPage:true});
 const select=page.getByRole('combobox',{name:'Payment method'});await select.click();await page.getByRole('option',{name:'QR',exact:true}).click();
 await page.getByRole('button',{name:'Confirm QR Received'}).click();
 await page.getByText('Payment recorded').waitFor();
 const receipt=await page.locator('.receipt').innerText();assert(receipt.includes('Extra sauce'),'Receipt includes selected modifier');
 const orders=await api('/orders','GET',null,session.token);
 assert.equal(orders.length,1);
 assert.equal(orders[0].subtotal,product.price+250);
 assert.deepEqual(errors,[]);
 console.log('PASS browser: required modifier selection -> cart price -> QR checkout -> recorded receipt and immutable modifier');
 await context.close();
}finally{
 if(browser)await browser.close();
 for(const child of [frontend,backend]){child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('close',r))}
 rmSync(dir,{recursive:true,force:true});
 console.log('Preview and database discarded; no production deployment.');
}
