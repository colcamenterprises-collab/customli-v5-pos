import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(tmpdir()+'/customli-universal-'),tokens=Object.fromEntries(['pos','pos2','cds','kds','wrongTenant','wrongLocation'].map(k=>[k,randomBytes(32).toString('base64url')]));let revoked=false;
const auth=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),kind=Object.keys(tokens).find(k=>tokens[k]===b.token);res.setHeader('Content-Type','application/json');if(!kind||revoked){res.statusCode=401;return res.end('{}')}res.end(JSON.stringify({id:'owner',email:'owner@test.test',displayName:'QA',memberships:[{tenantId:kind==='wrongTenant'?'other':'tenant',role:'Owner'}],device:{id:kind,tenantId:kind==='wrongTenant'?'other':'tenant',locationId:kind==='wrongLocation'?'other':'restaurant',mode:kind==='cds'?'CDS':kind==='kds'?'KDS':'POS',posDeviceId:kind==='cds'?'pos':null}}))});await new Promise(r=>auth.listen(0,'127.0.0.1',r));
const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const api=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,PORT:String(port),V5_DATA_DIR:dir,V5_DEMO_SEED:'1',V5_API_PREFIX:'/v5/api',V5_PRINT_KDS_DB:'',PLATFORM_AUTH_INTROSPECT_URL:`http://127.0.0.1:${auth.address().port}/api/auth/introspect`,PLATFORM_AUTH_SERVICE_SECRET:'isolated-test',PLATFORM_TENANT_ID:'tenant',PLATFORM_LOCATION_ID:'restaurant'},stdio:['ignore','pipe','pipe']});let log='';api.stderr.on('data',c=>log+=c);
async function call(path,method='GET',body,kind='pos'){const r=await fetch(`http://127.0.0.1:${port}/v5/api`+path,{method,headers:{Authorization:'Bearer '+tokens[kind],'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data};
try{
 for(let i=0;i<100;i++){try{if((await call('/me')).status===200)break}catch{}if(api.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,30))}
 assert.equal((await call('/me','GET',null,'wrongTenant')).status,401);assert.equal((await call('/me','GET',null,'wrongLocation')).status,401);
 for(const route of ['/products','/reports','/shift','/users'])assert.equal((await call(route,'GET',null,'cds')).status,403);
 assert.equal((await call('/me','GET',null,'kds')).status,403);
 const originalShift=ok(await call('/shift/open','POST',{openingCash:0}),201).shift;
 const products=ok(await call('/products')),product=products[0];
 ok(await call('/display','POST',{revision:1,items:[{productId:product.id,quantity:2}]}));
 let display=ok(await call('/display','GET',null,'cds'));assert.equal(display.total,product.price*2);assert.equal(display.items[0].name,product.name);assert.equal(display.state,'order');assert(!JSON.stringify(display).includes('owner@test'));
 assert.equal((await call('/display','POST',{revision:2,items:[]},'cds')).status,403);
 assert.equal((await call('/display?posDeviceId=pos2','GET',null,'cds')).status,403);
 assert.equal((await call('/display','POST',{revision:1,items:[]})).status,409);assert.equal(ok(await call('/display','GET',null,'cds')).state,'order','Delayed display snapshot cannot overwrite newer state');
 let first;
 for(let i=0;i<30;i++){
  const body={idempotencyKey:'universal-'+i,expectedShiftId:originalShift.id,expectedTotalMinor:product.price,items:[{productId:product.id,quantity:1}],paymentMethod:'Cash',received:1000};
  const sale=ok(await call('/orders','POST',body),201);if(!first)first=sale;
  assert.equal(ok(await call('/orders','POST',body)).id,sale.id);
  assert.equal((await call('/orders','POST',{...body,received:1001})).status,409);
  if(i===0)assert.equal((await call('/orders','POST',body,'pos2')).status,403);
 }
 ok(await call('/display','POST',{revision:2,orderId:first.id}));display=ok(await call('/display','GET',null,'cds'));assert.equal(display.state,'recorded');assert.equal(display.total,first.total-first.discount_total);
 assert.equal((await call('/display','POST',{revision:3,orderId:first.id},'pos2')).status,404);
 ok(await call('/shift/close','POST',{closingCash:0}));ok(await call('/shift/open','POST',{openingCash:0}),201);const staleBody={idempotencyKey:'stale-shift',expectedShiftId:originalShift.id,expectedTotalMinor:product.price,items:[{productId:product.id,quantity:1}],paymentMethod:'Cash',received:1000};assert.equal((await call('/orders','POST',staleBody)).status,409,'Queued sale cannot move to a different shift');assert.equal(ok(await call('/display/revision')).revision,2);
 const db=new DatabaseSync(dir+'/pos.sqlite',{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,30);assert.equal(db.prepare("SELECT value FROM sequence WHERE name='receipt'").get().value,30);assert.equal(db.prepare('SELECT COUNT(*) n FROM kitchen_outbox').get().n,30);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
 revoked=true;assert.equal((await call('/display','GET',null,'cds')).status,401);
 console.log('PASS universal API: 30 orders, duplicate/mutated retry protection, scoped CDS, tenant/location/mode enforcement, revocation and integrity');
}finally{api.kill();await new Promise(r=>api.once('exit',r));await new Promise(r=>auth.close(r));rmSync(dir,{recursive:true,force:true})}
