// Read-only deployed smoke: canonical platform auth is mandatory in production.
// Do not insert legacy POS sessions: platform introspection rejects those tokens.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const test=process.argv[2]==='test';
const host='https://customli.io';
const api=test?'/v5-test/api':'/v5/api';
const dashboard=test?'/v5-dashboard-test/':'/v5-dashboard/';
const pos=test?'/v5-test/':'/v5/';
const response=await fetch(host+api+'/print/state');
assert.equal(response.status,401,'Print settings must require canonical platform authentication');
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:820,height:1180}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(host+pos,{waitUntil:'domcontentloaded'});
 await page.waitForURL('**'+dashboard,{timeout:15000});
 await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor({timeout:15000});
 assert.equal(await page.getByLabel(/Email/).count(),1);
 assert.equal(await page.getByRole('button',{name:'Forgot password?'}).count(),1);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Tablet must not overflow horizontally');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({environment:test?'test':'production',publicRoutes:'POS redirects to platform login',receiptApi:'401 for unauthenticated caller (expected)',authenticatedReceiptPreview:'not tested without platform Owner session',hardwareValidated:false}));
}finally{await browser?.close()}
