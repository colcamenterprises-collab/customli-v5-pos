// Deployed browser check: the Dashboard is the sole login and password-recovery entry point.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const test=process.argv.includes('test'),base=test?'/v5-test/':'/v5/',dashboard=test?'/v5-dashboard-test/':'/v5-dashboard/';
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://customli.io'+base,{waitUntil:'networkidle'});
 await page.waitForURL('**'+dashboard,{timeout:15000});
 await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
 await page.locator('.auth-logo img').evaluate(img=>img.decode());
 assert.match(await page.locator('.auth-logo img').getAttribute('src'),/customli-login-logo\.svg$/,'Official login logo is required');
 assert.equal(await page.getByLabel(/Email/).count(),1);assert.equal(await page.locator('input[type=\"password\"]').count(),1);
 assert.equal(await page.getByRole('button',{name:'Show password'}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Forgot password?'}).count(),1);
 assert.equal(await page.getByRole('button').filter({hasText:/Google|Apple/}).count(),0);
 for(const [width,height] of [[1536,724],[1280,720],[1024,768],[820,1180],[390,844]]){
  await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width);
  await page.screenshot({path:'/tmp/v5-dashboard-login-'+width+'.png'});
 }
 await page.getByRole('button',{name:'Forgot password?'}).click();
 await page.getByRole('heading',{name:'Reset Password',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Send code'}).count(),1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({environment:test?'test':'production',passed:'POS redirects to Dashboard login; logo, email, password visibility, recovery entry and five responsive viewports verified',hardwareValidated:false}));
}finally{await browser?.close()}
