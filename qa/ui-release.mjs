import {chromium} from 'playwright';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {startPlatformAuthFixture} from './platform-auth-fixture.mjs';
const root=process.cwd(), dist=path.resolve(process.env.UI_DIST||'dist'), base=process.env.UI_BASE||'/v5/', update=process.argv.includes('--update-baselines');
if(update && process.env.ALLOW_VISUAL_BASELINE_UPDATE!=='reviewed') throw Error('Baseline replacement requires ALLOW_VISUAL_BASELINE_UPDATE=reviewed and a reviewed baseline diff.');
const refs=path.join(root,'qa/visual-baselines'),output=path.join(root,'qa/release-results',base.includes('test')?'test':'production');mkdirSync(output,{recursive:true});
const data=mkdtempSync(path.join(tmpdir(),'v5-ui-gate-')),password='isolated-ui-release-test',fixture=await startPlatformAuthFixture();
const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const apiPort=portServer.address().port;await new Promise(r=>portServer.close(r));
const api=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(apiPort),V5_DATA_DIR:data,V5_BOOTSTRAP_PASSWORD:password,V5_DEMO_SEED:'1',V5_API_PREFIX:base+'api',V5_PRINT_KDS_DB:'',PLATFORM_AUTH_INTROSPECT_URL:fixture.url+'/introspect',PLATFORM_AUTH_SERVICE_SECRET:fixture.secret,PLATFORM_TENANT_ID:fixture.tenantId},stdio:['ignore','pipe','pipe']});let apiLog='';api.stderr.on('data',c=>apiLog+=c);
const web=http.createServer(async(req,res)=>{try{
 if(req.url.startsWith('/v5-auth/api/auth/')||req.url.startsWith('/v5-auth-test/api/auth/')){const prefix=req.url.startsWith('/v5-auth-test/')?'/v5-auth-test/api/auth':'/v5-auth/api/auth',chunks=[];for await(const c of req)chunks.push(c);const r=await fetch(fixture.url+req.url.slice(prefix.length),{method:req.method,headers:{'Content-Type':req.headers['content-type']||'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return}
 if(req.url.startsWith(base+'api/')){const chunks=[];for await(const c of req)chunks.push(c);const headers={...req.headers};delete headers.host;delete headers.origin;const r=await fetch('http://127.0.0.1:'+apiPort+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json'});res.end(Buffer.from(await r.arrayBuffer()));return}
 const relative=decodeURIComponent(req.url.split('?')[0]).slice(base.length);const file=path.resolve(dist,relative||'index.html');if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}if(!existsSync(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(readFileSync(file));
}catch(e){res.writeHead(500);res.end(e.message)}});
let browser;
try{
 let ready=false;for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:'+apiPort+base+'api/health');ready=true;break}catch{await new Promise(r=>setTimeout(r,50))}}assert(ready,'Isolated API failed: '+apiLog);
 const db=new DatabaseSync(path.join(data,'pos.sqlite'));db.prepare("UPDATE users SET role='Owner' WHERE username='manager'").run();
 const svg='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" rx="12" fill="#e0f3ee"/><circle cx="80" cy="60" r="32" fill="#0cae8b"/></svg>').toString('base64');db.prepare('UPDATE products SET image=?').run(svg);db.close();
 await new Promise(r=>web.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+web.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Asia/Bangkok',reducedMotion:'reduce'});
 // No third-party fonts or network content in reference screenshots.
 await context.route('**/*',r=>r.request().url().startsWith(origin)||r.request().url().startsWith('data:')?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const snapshot=async(name)=>{
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))});
  const current=await page.screenshot({animations:'disabled',caret:'hide',path:path.join(output,name+'.png')});const reference=path.join(refs,name+'.png');
  if(update){mkdirSync(refs,{recursive:true});writeFileSync(reference,current);return}
  assert(existsSync(reference),'Missing reviewed reference '+name);
  const a=await sharp(current).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(reference).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.deepEqual(a.info,b.info,'Screenshot dimensions changed: '+name);
  let changed=0;const diff=Buffer.alloc(a.data.length);for(let i=0;i<a.data.length;i+=4){const bad=Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])))>24;if(bad)changed++;diff[i]=bad?255:0;diff[i+3]=255}
  const ratio=changed/(a.info.width*a.info.height);if(ratio>0.001){await sharp(diff,{raw:a.info}).png().toFile(path.join(output,name+'-diff.png'));throw Error(name+': visual change '+(ratio*100).toFixed(3)+'% exceeds 0.1%; inspect actual/reference/diff, do not auto-update baselines')}
 };
 const bounds=async()=>{
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows horizontally');
  const logo=page.locator('.logo');if(await logo.isVisible()){const outer=await logo.boundingBox(),inner=await logo.locator('img').boundingBox();assert(inner.width<=58&&inner.height<=58&&inner.width<=outer.width+1&&inner.height<=outer.height+1,'Logo escapes its approved bounds')}
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--control-border').trim()),'#dfe5e4','Shared design tokens missing');
 };
 await page.addInitScript(token=>sessionStorage.setItem('customli-platform-session',token),fixture.token);await page.goto(origin+base);await page.getByRole('button',{name:'Add to cart',exact:true}).first().waitFor();
 for(const [name,width,height] of [['desktop',1440,900],['tablet',1024,768],['portrait',820,1180],['mobile',390,844]]){await page.setViewportSize({width,height});await bounds();await snapshot('menu-'+name)}
 await page.setViewportSize({width:1440,height:900});await page.getByRole('combobox',{name:'Payment method',exact:true}).click();await page.getByRole('listbox').waitFor();await snapshot('payment-dropdown');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Add to cart',exact:true}).first().click();await page.locator('.line').waitFor();await snapshot('populated-cart');
 await page.getByRole('button',{name:'Payment request',exact:true}).click();await page.getByAltText('Unpaid bill preview').waitFor();
 // Generated bill date/reference are separately tested by backend tests; hide only the image pixels.
 await page.getByAltText('Unpaid bill preview').evaluate(e=>e.style.visibility='hidden');await snapshot('payment-request-modal');

 const request=async(route,method='GET',body)=>{const r=await fetch('http://127.0.0.1:'+apiPort+base+'api'+route,{method,headers:{Authorization:'Bearer '+fixture.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert(r.ok,await r.clone().text());return r.json()};
 const product=(await request('/products'))[0];
 const extras=await request('/modifier-groups','POST',{name:'Unlimited extras',minSelect:0,maxSelect:null,options:[{name:'Extra cheese',priceMinor:2000,quantity:2},{name:'Extra bacon',priceMinor:3000,quantity:1}]});
 await request('/products/'+product.id+'/modifier-groups','POST',{groupIds:[extras.id]});
 await page.reload();await page.getByRole('button',{name:'Add to cart',exact:true}).first().click();
 const picker=page.getByRole('dialog',{name:'Customise '+product.name});await picker.waitFor();
 await picker.getByRole('button',{name:'Add Extra cheese',exact:true}).click();
 assert.equal(await picker.locator('.modifier-qty').first().locator('span').innerText(),'2','Configured quantity is used on first addition');
 for(let i=0;i<28;i++)await picker.getByRole('button',{name:'Add Extra cheese',exact:true}).click();
 for(let i=0;i<2;i++)await picker.getByRole('button',{name:'Add Extra bacon',exact:true}).click();
 assert.equal(await picker.locator('.modifier-qty').first().locator('span').innerText(),'30');
 assert.equal(await picker.locator('.modifier-qty').last().locator('span').innerText(),'2','Unlimited modifier can exceed 30 across options');
 await picker.getByRole('button',{name:'Add to cart',exact:true}).click();await picker.waitFor({state:'hidden'});
 const choose=await request('/modifier-groups','POST',{name:'Included drink',minSelect:1,maxSelect:1,options:[{name:'Coke',priceMinor:0,quantity:1},{name:'Sprite',priceMinor:0,quantity:1}]});
 await request('/products/'+product.id+'/modifier-groups','POST',{groupIds:[choose.id]});
 await page.reload();await page.getByRole('button',{name:'Add to cart',exact:true}).first().click();await picker.waitFor();
 await picker.getByRole('button',{name:'Add to cart',exact:true}).click();await picker.getByRole('alert').waitFor();
 await picker.getByRole('button',{name:'Add Coke',exact:true}).click();
 assert(await picker.getByRole('button',{name:'Add Sprite',exact:true}).isDisabled(),'Choose maximum blocks further selections');
 await page.setViewportSize({width:1024,height:768});await bounds();await page.screenshot({path:path.join(output,'modifier-choose-tablet.png')});
 await picker.getByRole('button',{name:'Add to cart',exact:true}).click();await picker.waitFor({state:'hidden'});
 console.log('PASS real API modifier picker: optional over 30, configured quantity, required choice, upper bound and tablet layout');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',base,snapshots:7,isolatedDatabase:true,hardwareValidated:false}));
}finally{await browser?.close();await new Promise(r=>web.close(r));if(api.exitCode===null){api.kill();await new Promise(r=>api.once('exit',r))}await fixture.close();rmSync(data,{recursive:true,force:true})}
