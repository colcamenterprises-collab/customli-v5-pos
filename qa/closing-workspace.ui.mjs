import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4479','--strictPort'],{cwd:new URL('..',import.meta.url).pathname,stdio:'ignore'});
let browser;
try{
 let ready=false;
 for(let i=0;i<100;i++){
  try{ready=(await fetch('http://127.0.0.1:4479/qa/closing-workspace-harness.html')).ok;if(ready)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready,'Closing workspace fixture started');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:820,height:1180}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:4479/qa/closing-workspace-harness.html');
 await page.getByRole('heading',{name:'Sales & cash'}).waitFor();
 await page.getByText('Direct').waitFor();
 assert.equal(await page.getByText(/expected cash|theoretical stock|stock variance/i).count(),0,'Staff cannot see expected figures');
 const inputs=page.locator('section[aria-label="Closing tasks"] input');
 await inputs.nth(0).fill('1');await inputs.nth(1).fill('120.00');
 await inputs.nth(2).fill('1');await inputs.nth(3).fill('120.00');
 await page.getByLabel('Cash counted (THB)').fill('120.00');
 await page.evaluate(()=>{window.closingFixture.offline=true});
 await page.getByRole('button',{name:'Submit sales'}).click();
 await page.getByText('Submission waiting to sync').waitFor();
 assert.notEqual(await page.evaluate(()=>window.closingFixture.state.reconciliation?.status),'submitted');
 await page.evaluate(()=>{window.closingFixture.offline=false});
 await page.getByRole('button',{name:'Sales submitted'}).waitFor({timeout:12000});
 assert.equal(await page.evaluate(()=>window.closingFixture.state.reconciliation.payload.cashMinor),12000);
 await page.getByRole('button',{name:'Stock count'}).click();
 await page.getByText('0 of 1 counted').waitFor();
 await page.evaluate(()=>{window.closingFixture.offline=true});
 await page.reload();
 await page.getByRole('button',{name:'Stock count'}).click();
 await page.getByText('Burger rolls').waitFor();
 await page.evaluate(()=>{window.closingFixture.offline=false});
 await page.getByRole('button',{name:'Submit stock count'}).click();
 await page.getByText('Count every selected item. Enter 0 when there is none.').waitFor();
 await page.getByLabel('Quantity').fill('0');
 await page.getByRole('button',{name:'Submit stock count'}).click();
 await page.getByRole('button',{name:'Count submitted'}).waitFor({timeout:12000});
 assert.equal(await page.evaluate(()=>window.closingFixture.state.entries[0].quantity_base),0);
 await page.getByRole('button',{name:'Requisition',exact:true}).click();
 await page.getByRole('button',{name:'Start requisition'}).click();
 await page.getByRole('searchbox',{name:'Find an item'}).waitFor();
 await page.getByLabel('Quantity').fill('12');
 await page.getByRole('button',{name:'Submit requisition'}).click();
 await page.getByRole('button',{name:'Requisition submitted',exact:true}).waitFor({timeout:12000});
 assert.equal(await page.evaluate(()=>window.closingFixture.state.requestItems[0].requested_base),12);
 for(const width of [390,820,1440]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS closing workspace: blind sales, offline submission retry, zero count, requisition, responsive widths');
}finally{
 await browser?.close();server.kill('SIGTERM');
}
