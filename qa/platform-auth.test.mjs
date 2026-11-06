import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {startPlatformAuthFixture} from './platform-auth-fixture.mjs';
const data=mkdtempSync(path.join(tmpdir(),'v5-platform-auth-'));
const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const fixture=await startPlatformAuthFixture();
const api=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),V5_DATA_DIR:data,V5_BOOTSTRAP_PASSWORD:'LegacyLocalPass123',V5_API_PREFIX:'/v5/api',V5_PRINT_KDS_DB:'',PLATFORM_AUTH_INTROSPECT_URL:fixture.url+'/introspect',PLATFORM_AUTH_SERVICE_SECRET:fixture.secret,PLATFORM_TENANT_ID:fixture.tenantId},stdio:'ignore'});
const base='http://127.0.0.1:'+port+'/v5/api';
const request=(route,options={})=>fetch(base+route,options);
try{
 let ready=false;for(let i=0;i<100;i++){try{await request('/health');ready=true;break}catch{await new Promise(r=>setTimeout(r,50))}}assert(ready,'POS API did not start');
 const disabled=await request('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'manager',password:'LegacyLocalPass123'})});assert.equal(disabled.status,410,'POS local credentials must be disabled when Dashboard auth is configured');
 const db=new DatabaseSync(path.join(data,'pos.sqlite'));
 const old=db.prepare("SELECT id FROM users WHERE username='manager'").get().id,localToken=randomBytes(32).toString('hex');
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(localToken).digest('hex'),old,new Date(Date.now()+3600000).toISOString());db.close();
 const legacy=await request('/me',{headers:{Authorization:'Bearer '+localToken}});assert.equal(legacy.status,401,'POS must reject legacy local sessions after central auth is enabled');
 const central=await request('/me',{headers:{Authorization:'Bearer '+fixture.token}});assert.equal(central.status,200);const user=await central.json();assert.equal(user.id,fixture.accountId);assert.equal(user.role,'Owner');
 const shadow=new DatabaseSync(path.join(data,'pos.sqlite'),{readOnly:true});assert.equal(shadow.prepare('SELECT role FROM users WHERE id=?').get(fixture.accountId).role,'Owner');shadow.close();
 await fetch(fixture.url+'/logout',{method:'POST',headers:{Authorization:'Bearer '+fixture.token}});
 const afterLogout=await request('/me',{headers:{Authorization:'Bearer '+fixture.token}});assert.equal(afterLogout.status,401,'Dashboard logout must be effective on the next POS API call');
 console.log('PASS Dashboard is the exclusive identity source when configured: local password login disabled, old POS sessions rejected, central Owner introspection accepted and shadow row persisted');
}finally{await fixture.close();if(api.exitCode===null){api.kill();await new Promise(r=>api.once('exit',r))}rmSync(data,{recursive:true,force:true});}
