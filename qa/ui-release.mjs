import {chromium} from 'playwright';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const root=process.cwd(), dist=path.resolve(process.env.UI_DIST||'dist'), base=process.env.UI_BASE||'/v5/', update=process.argv.includes('--update-baselines');
if(update && process.env.ALLOW_VISUAL_BASELINE_UPDATE!=='reviewed') throw Error('Baseline replacement requires ALLOW_VISUAL_BASELINE_UPDATE=reviewed and a reviewed baseline diff.');
const refs=path.join(root,'qa/visual-baselines'),output=path.join(root,'qa/release-results',base.includes('test')?'test':'production');mkdirSync(output,{recursive:true});
const data=mkdtempSync(path.join(tmpdir(),'v5-ui-gate-')),password='isolated-ui-release-test';
const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const apiPort=portServer.address().port;await new Promise(r=>portServer.close(r));
const api=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(apiPort),V5_DATA_DIR:data,V5_BOOTSTRAP_PASSWORD:password,V5_DEMO_SEED:'1',V5_API_PREFIX:base+'api',V5_PRINT_KDS_DB:''},stdio:['ignore','pipe','pipe']});let apiLog='';api.stderr.on('data',c=>apiLog+=c);
const web=http.createServer(async(req,res)=>{try{
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
 await page.goto(origin+base);await page.locator('.login-card').waitFor();await bounds();await snapshot('login-desktop');
 await page.getByLabel('Username').fill('manager');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Add to cart',exact:true}).first().waitFor();
 for(const [name,width,height] of [['desktop',1440,900],['tablet',1024,768],['portrait',820,1180],['mobile',390,844]]){await page.setViewportSize({width,height});await bounds();await snapshot('menu-'+name)}
 await page.setViewportSize({width:1440,height:900});await page.getByRole('combobox',{name:'Payment method',exact:true}).click();await page.getByRole('listbox').waitFor();await snapshot('payment-dropdown');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Add to cart',exact:true}).first().click();await page.locator('.line').waitFor();await snapshot('populated-cart');
 await page.getByRole('button',{name:'Payment request',exact:true}).click();await page.getByAltText('Unpaid bill preview').waitFor();
 // Generated bill date/reference are separately tested by backend tests; hide only the image pixels.
 await page.getByAltText('Unpaid bill preview').evaluate(e=>e.style.visibility='hidden');await snapshot('payment-request-modal');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',base,snapshots:8,isolatedDatabase:true,hardwareValidated:false}));
}finally{await browser?.close();await new Promise(r=>web.close(r));if(api.exitCode===null){api.kill();await new Promise(r=>api.once('exit',r))}rmSync(data,{recursive:true,force:true})}
