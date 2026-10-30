import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

test('checkout enforces cashier permissions, manager PIN, role restriction and audit identity',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'v5-discount-test-')),port=44031,base='http://127.0.0.1:'+port+'/v5/api';
 const child=spawn(process.execPath,['--no-warnings','server.mjs'],{cwd:new URL('..',import.meta.url).pathname.replace(/\/qa\/$/,'/'),env:{...process.env,V5_DATA_DIR:dir,PORT:String(port),V5_KDS_ROUTING_ENABLED:'0',V5_BOOTSTRAP_PASSWORD:''},stdio:['ignore','pipe','pipe']});
 let output='';child.stderr.on('data',b=>{output+=String(b).slice(0,500)});
 t.after(()=>{child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true})});
 let ready=false;for(let i=0;i<90;i++){try{const r=await fetch(base+'/health');if(r.status===401){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,80))}assert.ok(ready,'Isolated server did not start: '+output.slice(0,300));
 const db=new DatabaseSync(path.join(dir,'pos.sqlite'));
 const now=new Date().toISOString();
 const tokens={};
 for(const role of ['Owner','Manager','Cashier']){
  const id=randomUUID(),salt=randomBytes(8).toString('hex'),token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO users(id,username,role,salt,password_hash) VALUES(?,?,?,?,?)').run(id,role.toLowerCase(),role,salt,scryptSync('isolated-qa-password',salt,64).toString('hex'));
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  tokens[role]={id,token};
 }
 const manager=tokens.Manager,pin='468215',psalt=randomBytes(8).toString('hex');
 db.prepare('INSERT INTO manager_pins(user_id,salt,pin_hash,failed_attempts) VALUES(?,?,?,0)').run(manager.id,psalt,scryptSync(pin,psalt,64).toString('hex'));
 db.prepare('INSERT INTO shifts(id,opened_at,opening_cash) VALUES(?,?,?)').run(randomUUID(),now,250000);
 const product=db.prepare('SELECT id,price FROM products WHERE active=1 LIMIT 1').get();assert.ok(product);
 const make=(name,mode)=>{const id=randomUUID();db.prepare('INSERT INTO discount_catalog(id,name,kind,value,active,created_by,created_at,updated_at,access_mode) VALUES(?,?,?,?,1,?,?,?,?)').run(id,name,'percent',1000,tokens.Owner.id,now,now,mode);return id};
 const unrestricted=make('Cashier Ok','cashier'),protectedId=make('PIN Needed','manager_pin'),restricted=make('Owner Only','manager_only');
 const api=async(role,endpoint,body)=>{const r=await fetch(base+endpoint,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[role].token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const attempt=(discountId,approval,extra={})=>({idempotencyKey:randomUUID(),items:[{productId:product.id,quantity:1}],paymentMethod:'QR',mode:'Takeaway',discountId,...(approval?{approval}:{}),...extra});
 const visible=await api('Cashier','/discount-catalog');assert.equal(visible.status,200);assert.ok(visible.data.some(d=>d.id===unrestricted));assert.ok(visible.data.some(d=>d.id===protectedId));assert.ok(!visible.data.some(d=>d.id===restricted));
 let r=await api('Cashier','/orders',attempt(unrestricted));assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.discount_total,Math.round(product.price*0.1));
 let row=db.prepare('SELECT staff_id,approved_by FROM discounts WHERE order_id=?').get(r.data.id);assert.equal(row.staff_id,tokens.Cashier.id);assert.equal(row.approved_by,tokens.Cashier.id);
 r=await api('Cashier','/orders',attempt(protectedId));assert.equal(r.status,403);
 r=await api('Cashier','/orders',attempt(protectedId,{managerId:manager.id,pin:'000000'}));assert.equal(r.status,403);
 r=await api('Cashier','/orders',attempt(protectedId,{managerId:manager.id,pin}));assert.equal(r.status,201,JSON.stringify(r.data));
 row=db.prepare('SELECT staff_id,approved_by FROM discounts WHERE order_id=?').get(r.data.id);assert.equal(row.staff_id,tokens.Cashier.id);assert.equal(row.approved_by,manager.id);
 r=await api('Cashier','/orders',attempt(restricted));assert.equal(r.status,403);
 r=await api('Cashier','/orders',attempt(restricted,{managerId:manager.id,pin}));assert.equal(r.status,403);
 r=await api('Manager','/orders',attempt(restricted));assert.equal(r.status,201);
 r=await api('Owner','/orders',attempt(restricted));assert.equal(r.status,201);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,4);
 db.close();
});
