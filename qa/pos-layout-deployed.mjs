// Read-only browser regression for the oversized branding image reported on Android.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const test=process.argv.includes('test'),candidate=process.argv.includes('--candidate');
const base=test?'/v5-test/':'/v5/',db=new DatabaseSync(test?'/var/lib/customli-v5-test/pos.sqlite':'/var/lib/customli-v5/pos.sqlite');
const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
const owner=db.prepare("SELECT id FROM users WHERE role='Owner' AND active=1 LIMIT 1").get();
let browser;
const output='qa/print-results/pos-layout';await mkdir(output,{recursive:true});
try{
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash,owner.id,new Date(Date.now()+180000).toISOString());
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext();const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 if(candidate){const css=await readFile('style.css','utf8');await page.addInitScript(css=>{document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style)})},css)}
 await page.goto('https://customli.io'+base);await page.locator('.login-card').waitFor();
 await page.locator('.logo img').evaluate(img=>img.decode());
 assert.match(await page.locator('.logo img').getAttribute('src'),/customli-symbol\.svg$/,'Official Customli logo must be shown');
 const verifyLogo=async()=>{const box=await page.locator('.logo').boundingBox(),image=await page.locator('.logo img').boundingBox();if(box){assert(image.width<=box.width+1&&image.height<=box.height+1,'Logo image escapes its container');assert(image.width<=58&&image.height<=58,'Logo exceeds approved 58px size')}};
 await verifyLogo();
 await page.evaluate(({token,test})=>sessionStorage.setItem(test?'v5_test_token':'v5_token',token),{token,test});await page.reload();
 await page.getByRole('button',{name:'Add to cart',exact:true}).first().waitFor();
 for(const [width,height] of [[1536,724],[1280,720],[1024,768],[820,1180],[390,844]]){
  await page.setViewportSize({width,height});await page.locator('.logo img').evaluate(img=>img.decode());await verifyLogo();
  assert(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--control-border').trim()==='#dfe5e4'),'Shared control design tokens missing');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal page overflow');
  await page.screenshot({path:output+'/'+(test?'test':'production')+'-'+width+(candidate?'-candidate':'')+'.png'});
 }
 await page.setViewportSize({width:1536,height:724});
 assert.equal(await page.getByRole('button',{name:'Direct',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('combobox',{name:'Direct order type',exact:true}).click();await page.getByRole('listbox').waitFor();
 assert.equal(await page.getByRole('option',{name:'Takeaway',exact:true}).count(),1);
 assert.equal(await page.getByRole('option',{name:'Dine In',exact:true}).count(),1);
 assert.equal(await page.getByRole('listbox').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({environment:test?'test':'production',candidate,passed:'Login and POS logo containment, shared control styles, direct order dropdown, five viewport sizes, no page errors',hardwareValidated:false}));
}finally{await browser?.close();db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);db.close()}
