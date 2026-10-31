import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

const dir=mkdtempSync(path.join(tmpdir(),'customli-v5-onboard-http-'));
const probe=net.createServer();
await new Promise(ok=>probe.listen(0,'127.0.0.1',ok));
const port=probe.address().port;
await new Promise(ok=>probe.close(ok));
const password='isolated-onboarding-only-password-2026';
const api='http://127.0.0.1:'+port+'/v5-test/api';
const child=spawn(process.execPath,['server.mjs'],{
 cwd:new URL('..',import.meta.url).pathname,
 env:{...process.env,PORT:String(port),V5_DATA_DIR:dir,V5_API_PREFIX:'/v5-test/api',V5_DEMO_SEED:'0',
 V5_BOOTSTRAP_PASSWORD:password,V5_KDS_ROUTING_ENABLED:'0',V5_PRINT_KDS_DB:''},
 stdio:['ignore','pipe','pipe']
});
let log='';child.stderr.on('data',x=>log+=x);
const account={snapshot:{organization:{id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',name:'First Restaurant'},
 locations:[{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',name:'First Restaurant',address_line1:'1 Restaurant Road',timezone:'Asia/Bangkok',currency:'THB'}],
 onboarding:{intake_data:{screens:['A till at the counter','A receipt printer'],source:'restaurant-ops-v3-site',version:1}}}};
let bearer='';
async function req(p,method='GET',body) {
 const res=await fetch(api+p,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {code:res.status,data:await res.json()};
}
try{
 let ready=false;
 for(let i=0;i<150;i++){try{await fetch(api+'/health');ready=true;break}catch{await new Promise(r=>setTimeout(r,50))}}
 assert(ready,'Isolated API did not start: '+log);
 const db=new DatabaseSync(path.join(dir,'pos.sqlite'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM products').get().n,0,'LIVE-mode setup must never include demo sushi');
 db.prepare("UPDATE users SET role='Owner' WHERE username='manager'").run();
 db.close();
 assert.equal((await req('/onboarding')).code,401,'Public cannot import website data');
 const auth=await req('/login','POST',{username:'manager',password});
 assert.equal(auth.code,200,'Isolated owner login must work');
 bearer=auth.data.token;
 assert.equal((await req('/onboarding')).data.readiness.profile,false);
 const preview=await req('/onboarding/preview','POST',account);
 assert.equal(preview.code,200);
 assert.equal(preview.data.suggestions.printer.suggested,true);
 const apply=await req('/onboarding/apply','POST',account);
 assert.equal(apply.code,200);assert.equal(apply.data.changed,true);
 assert.equal((await req('/onboarding/apply','POST',account)).data.changed,false);
 const after=await req('/onboarding');
 assert.equal(after.data.profile.restaurantName,'First Restaurant');
 assert.equal(after.data.readiness.menu,false,'Import cannot fabricate a menu or claim sellable status');
 const print=await req('/print/state');
 assert.equal(print.code,200);
 assert(print.data.templates.some(t=>t.config.businessName==='First Restaurant'),'Receipt Studio must use imported name');
 console.log('PASS isolated HTTP signup-intake -> V5 owner approval -> receipt templates; demo-seed disabled; auth enforced; no fake menu or readiness.');
}finally{
 child.kill('SIGTERM');await new Promise(ok=>child.once('exit',ok));
 rmSync(dir,{recursive:true,force:true});
}
