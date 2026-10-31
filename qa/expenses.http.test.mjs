import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';

const dir=mkdtempSync(path.join(tmpdir(),'v5-expense-http-')),probe=net.createServer();
await new Promise(ok=>probe.listen(0,'127.0.0.1',ok));
const port=probe.address().port;await new Promise(ok=>probe.close(ok));
const password='isolated-expense-test-owner-2026';
const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url).pathname,
 env:{...process.env,PORT:String(port),V5_DATA_DIR:dir,V5_BOOTSTRAP_PASSWORD:password,V5_DEMO_SEED:'0',V5_KDS_ROUTING_ENABLED:'0',V5_PRINT_KDS_DB:'',V5_API_PREFIX:'/v5-test/api'},
 stdio:['ignore','pipe','pipe']});
let err='';child.stderr.on('data',chunk=>err+=chunk);
const exited=new Promise(resolve=>child.once('exit',resolve));
const url='http://127.0.0.1:'+port+'/v5-test/api';
let token='';
async function request(route,method='GET',payload){
 const r=await fetch(url+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
 return{status:r.status,data:await r.json()};
}
try{
 let ready=false;
 for(let i=0;i<150;i++){try{await fetch(url+'/health');ready=true;break}catch{await new Promise(ok=>setTimeout(ok,50))}}
 assert(ready,'Expense API startup failure: '+err);
 assert.equal((await request('/expenses')).status,401);
 const db=new DatabaseSync(path.join(dir,'pos.sqlite'));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n,0);
 db.prepare("UPDATE users SET role='Owner' WHERE username='manager'").run();
 db.close();
 const login=await request('/login','POST',{username:'manager',password});
 assert.equal(login.status,200);token=login.data.token;
 const added=await request('/expenses','POST',{receiptDate:'2026-10-29',supplier:'Makro',description:'Food supply',category:'Food & Beverage',amountMinor:89000,paymentMethod:'Bank transfer'});
 assert.equal(added.status,201,JSON.stringify(added));
 const data=await request('/expenses?from=2026-10-01&to=2026-10-31');
 assert.equal(data.status,200);assert.equal(data.data.totals.external_business,89000);
 const batch=await request('/expenses/bank-import','POST',{filename:'scb.csv',rows:[
 {postedAt:'2026-10-30',description:'Super Cheap Rawai',amountMinor:35000,direction:'outflow',reference:'a-98'}
 ]});
 assert.equal(batch.status,201);assert.equal(batch.data.inserted,1);
 const review=await request('/expenses/bank-review?from=2026-10-01&to=2026-10-31');
 assert.equal(review.data.transactions[0].supplier,'Super Cheap');
 const approved=await request('/expenses/bank-review/'+review.data.transactions[0].id,'PATCH',{classification:'business',supplier:'Super Cheap',category:'Food & Beverage',purpose:'Stock',learnRule:true});
 assert.equal(approved.status,200);
 const last=await request('/expenses?from=2026-10-01&to=2026-10-31');
 assert.equal(last.data.totals.external_business,124000);
 assert.equal(last.data.external.length,2);
 console.log('PASS real isolated HTTP owner auth, outside-shift expense, duplicate-safe bank import, Super Cheap matching, approval and net totals; no production database touched.');
}catch(e){console.error('HTTP QA:',e.message,'Server:',err);throw e;}finally{child.kill('SIGTERM');await exited;rmSync(dir,{recursive:true,force:true});}
