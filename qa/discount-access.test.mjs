import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {installDiscountCatalog,catalogRoute} from '../discount-catalog.mjs';
const setup=()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE discounts(id TEXT PRIMARY KEY);CREATE TABLE discount_catalog(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),value INTEGER NOT NULL CHECK(value>0),active INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.prepare("INSERT INTO discount_catalog VALUES('old','Legacy 100%','percent',10000,1,'owner','2026-10-01','2026-10-01')").run();
 installDiscountCatalog(db);installDiscountCatalog(db);
 return db;
};
const route=(db,p,method,role,b={})=>{
 const bad=(code,message)=>{const e=new Error(message);e.status=code;throw e};
 return catalogRoute({db,p,method,b,user:{id:role.toLowerCase(),role},res:{},send:(_,status,data)=>({status,data}),bad});
};
test('legacy discounts safely migrate to manager PIN while preserving values',()=>{
 const db=setup(),old=db.prepare('SELECT * FROM discount_catalog WHERE id=?').get('old');
 assert.equal(old.value,10000);assert.equal(old.access_mode,'manager_pin');
 assert.equal(db.prepare('PRAGMA table_info(discounts)').all().some(x=>x.name==='catalog_id'),true);
 db.close();
});
test('restaurant owner controls per-discount cashier permissions',()=>{
 const db=setup();
 const a=route(db,'/discount-catalog','POST','Owner',{name:'Member',kind:'percent',value:1000,accessMode:'cashier'});
 const b=route(db,'/discount-catalog','POST','Owner',{name:'Owner Special',kind:'percent',value:10000,accessMode:'manager_only'});
 assert.equal(a.status,201);assert.equal(b.data.access_mode,'manager_only');
 assert.deepEqual(route(db,'/discount-catalog','GET','Cashier').data.map(x=>x.name).sort(),['Legacy 100%','Member']);
 assert.equal(route(db,'/discount-catalog','GET','Manager').data.length,3);
 assert.equal(route(db,'/discount-catalog','GET','Owner').data.length,3);
 assert.equal(route(db,'/discount-catalog/'+b.data.id,'PATCH','Owner',{accessMode:'manager_pin'}).data.access_mode,'manager_pin');
 assert.equal(route(db,'/discount-catalog','GET','Cashier').data.length,3);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discount_catalog_audit').get().n,3);
 db.close();
});
test('no non-owner can create, modify or assign an invalid permission',()=>{
 const db=setup();
 assert.throws(()=>route(db,'/discount-catalog','POST','Cashier',{name:'Free meal',kind:'percent',value:10000,accessMode:'cashier'}),{status:403});
 assert.throws(()=>route(db,'/discount-catalog/old','PATCH','Manager',{accessMode:'cashier'}),{status:403});
 assert.throws(()=>route(db,'/discount-catalog/old','PATCH','Owner',{accessMode:'everyone'}),{status:400});
 assert.equal(db.prepare('SELECT access_mode FROM discount_catalog WHERE id=?').get('old').access_mode,'manager_pin');
 db.close();
});
