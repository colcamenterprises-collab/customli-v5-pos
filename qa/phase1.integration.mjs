import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const port=4445;
const dirname=mkdtempSync(path.join(tmpdir(),'v5-phase1-'));
const root='http://127.0.0.1:'+port+'/v5/api';
const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url).pathname,
 env:{...process.env,PORT:String(port),V5_DATA_DIR:dirname,V5_BOOTSTRAP_PASSWORD:'temporary-qa-only-strong-passphrase'},
 stdio:['ignore','pipe','pipe']});
let serverLog='';child.stderr.on('data',c=>serverLog+=c.toString());
const wait=async()=>{for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('QA server exited: '+serverLog);try{const r=await fetch(root+'/health');if(r.ok||r.status===401)return}catch{}await new Promise(r=>setTimeout(r,60))}throw Error('QA server failed: '+serverLog)};
let bearer;
async function call(route,method='GET',data=null,auth=true){
 const headers={'Content-Type':'application/json'};
 if(auth&&bearer)headers.Authorization='Bearer '+bearer;
 const response=await fetch(root+route,{method,headers,...(data?{body:JSON.stringify(data)}:{})});
 const value=await response.json();
 return{status:response.status,body:value};
}
function success(x,code=200){assert.equal(x.status,code,JSON.stringify(x.body));return x.body;}
try{
 await wait();
 const login=success(await call('/login','POST',{username:'manager',password:'temporary-qa-only-strong-passphrase'},false));
 bearer=login.token;
 const cats=success(await call('/categories')),products=success(await call('/products'));
 assert(cats.length>=1&&products.length>=1);
 const product=products[0];
 const group=success(await call('/modifier-groups','POST',{name:'Sauce selection',minSelect:1,maxSelect:2}),201);
 const normal=success(await call('/modifier-groups/'+group.id+'/options','POST',{name:'Extra sauce',priceMinor:150,sortOrder:1}),201);
 const noCost=success(await call('/modifier-groups/'+group.id+'/options','POST',{name:'No sauce',priceMinor:0}),201);
 success(await call('/products/'+product.id+'/modifier-groups','POST',{groupIds:[group.id]}));
 const assigned=success(await call('/products/'+product.id+'/modifier-groups'));
 assert.equal(assigned.length,1);assert.equal(assigned[0].options.length,2);
 const badRequired=await call('/orders','POST',{idempotencyKey:'missing-modifier',items:[{productId:product.id,quantity:1}],paymentMethod:'QR'});
 assert.equal(badRequired.status,409,'Should require a shift first');
 success(await call('/shift/open','POST',{openingCash:0}),201);
 assert.equal((await call('/orders','POST',{idempotencyKey:'required-test',items:[{productId:product.id,quantity:1}],paymentMethod:'QR'})).status,400);
 const withOption={idempotencyKey:'modifier-test',items:[{productId:product.id,quantity:2,modifiers:[{optionId:normal.id,quantity:1}],instructions:'Less salt'}],paymentMethod:'QR'};
 const sale=success(await call('/orders','POST',withOption),201);
 assert.equal(sale.items.length,1);
 assert.equal(sale.items[0].price,product.price+150);
 assert.equal(sale.subtotal,(product.price+150)*2);
 assert.equal(sale.items[0].modifiers[0].name,'Extra sauce');
 assert.equal(sale.items[0].instructions,'Less salt');
 const retry=success(await call('/orders','POST',withOption));
 assert.equal(retry.id,sale.id);
 const db=new DatabaseSync(path.join(dirname,'pos.sqlite'),{readOnly:true});
 const out=db.prepare('SELECT * FROM kitchen_outbox').all();
 assert.equal(out.length,1,'Idempotent retries must not create extra KDS deliveries');
 const snapshot=JSON.parse(out[0].payload);
 assert.equal(snapshot.items[0].quantity,2);
 assert.equal(snapshot.items[0].modifiers[0].priceMinor,150);
 assert.equal(snapshot.routingStatus,'awaiting_configuration','Cannot pretend station routing is complete');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM order_item_modifiers').get().n,1);
 db.close();
 assert.equal((await call('/orders','POST',{idempotencyKey:'invalid-option',items:[{productId:product.id,quantity:1,modifiers:[{optionId:'fabricated',quantity:1}]}],paymentMethod:'QR'})).status,400);
 assert.equal((await call('/orders','POST',{idempotencyKey:'too-many',items:[{productId:product.id,quantity:1,modifiers:[{optionId:normal.id,quantity:3}]}],paymentMethod:'QR'})).status,400);
 success(await call('/modifier-options/'+normal.id,'PATCH',{priceMinor:250}));
 const old=success(await call('/orders/'+sale.id));
 assert.equal(old.items[0].modifiers[0].priceMinor,150,'Historical receipt price must stay unchanged');
 const second=success(await call('/orders','POST',{idempotencyKey:'new-price',items:[{productId:product.id,quantity:1,modifiers:[{optionId:normal.id,quantity:1}]}],paymentMethod:'QR'}),201);
 assert.equal(second.items[0].price,product.price+250,'Future sale must use current server price');
 console.log('PASS: modifier group setup, required selection, server pricing, per-line immutable receipt snapshot, amendment-proof cost and idempotent KDS outbox');
 console.log('PASS: client cannot insert nonexistent option, exceed limits, or omit required modifier');
}finally{
 child.kill('SIGTERM');
 await new Promise(r=>child.once('close',r));
 rmSync(dirname,{recursive:true,force:true});
 console.log('Isolated QA database and service removed. Production never touched.');
}
