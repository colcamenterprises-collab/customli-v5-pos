import {TenantRegistry} from './tenant-registry.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root=mkdtempSync(path.join(tmpdir(),'v5-tenant-test-'));const registry=new TenantRegistry(root);
try{
 const a=registry.register({restaurantName:'First Restaurant',email:'owner1@example.test',password:'a-strong-passphrase-123'});
 const b=registry.register({restaurantName:'Second Restaurant',email:'owner2@example.test',password:'another-strong-passphrase-123'});
 assert.notEqual(a.tenantId,b.tenantId);
 const one=new DatabaseSync(path.join(root,'restaurants',a.tenantId,'pos.sqlite'));
 const two=new DatabaseSync(path.join(root,'restaurants',b.tenantId,'pos.sqlite'));
 assert.equal(one.prepare('SELECT name FROM restaurant_identity').get().name,'First Restaurant');
 assert.equal(two.prepare('SELECT name FROM restaurant_identity').get().name,'Second Restaurant');
 assert.equal(one.prepare('SELECT count(*) n FROM users').get().n,1);
 assert.equal(two.prepare('SELECT count(*) n FROM users').get().n,1);
 assert.throws(()=>registry.register({restaurantName:'Duplicate',email:'owner1@example.test',password:'a-strong-passphrase-123'}));
 assert.throws(()=>registry.register({restaurantName:'Bad',email:'owner3@example.test',password:'short'}));
 one.close();two.close();console.log('PASS separate restaurant databases, owner accounts, duplicate rejection, password policy');
}finally{registry.close();rmSync(root,{recursive:true,force:true})}
