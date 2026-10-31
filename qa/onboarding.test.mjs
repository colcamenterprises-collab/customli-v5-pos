import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migratePrint, templates, location } from '../print-model.mjs';
import { migrateOnboarding, handleOnboarding, normalizeWebsiteAccount } from '../onboarding.mjs';

function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, category TEXT, price INTEGER, active INTEGER);
 CREATE TABLE shifts(id TEXT PRIMARY KEY, closed_at TEXT);`);
 migratePrint(db);
 migrateOnboarding(db);
 return db;
}
const account=(restaurant='Noodle House',organizationId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', locationId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')=>({
 snapshot: { organization:{id:organizationId,name:restaurant},
 locations:[{id:locationId,name:restaurant,timezone:'Asia/Bangkok',currency:'THB',address_line1:'99 Example Road',city:'Phuket'}],
 onboarding:{intake_data:{restaurantName:restaurant,locations:'1',screens:['A till at the counter','A screen in the kitchen','A receipt printer'],version:1}}
 }});
const owner={id:'v5-owner',role:'Owner'},manager={id:'manager',role:'Manager'};
function call(db,p,method='GET',b=undefined,user=owner) {
 let status=0, result;
 const res={writeHead(n){status=n;},end(str){result=JSON.parse(str);}};
 const send=(r,s,d)=>{r.writeHead(s);r.end(JSON.stringify(d));};
 try{handleOnboarding({db,p,method,b,user,res,send});return{status,result};}
 catch(e){return{status:e.status||500,error:e.message};}
}
const db=fixture();
assert.equal(call(db,'/onboarding').result.readiness.profile,false);
assert.equal(call(db,'/onboarding').result.readiness.menu,false);
assert.equal(call(db,'/onboarding/preview','POST',account()).result.profile.restaurantName,'Noodle House');
assert.equal(call(db,'/onboarding/preview','POST',account()).result.suggestions.printer.connection,'not_verified');
assert.equal(call(db,'/onboarding/apply','POST',account(),manager).status,403);
assert.equal(call(db,'/onboarding/apply','POST',account()).status,200);
const print=templates(db,location(db));
assert.equal(print.length,7);
assert(print.every(t=>t.version===2&&t.config.businessName==='Noodle House'&&t.config.address==='99 Example Road, Phuket'));
assert.equal(call(db,'/onboarding/apply','POST',account()).result.changed,false);
assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_setup_events').get().n,1);
assert.equal(call(db,'/onboarding/apply','POST',account('Different','cccccccc-cccc-4ccc-cccc-cccccccccccc')).status,409);
assert.equal(call(db,'/onboarding').result.profile.restaurantName,'Noodle House');
assert.equal(call(db,'/onboarding/preview','POST', {...account(), snapshot:{...account().snapshot,locations:[{...account().snapshot.locations[0],currency:'USD'}]}}).result.readiness.locale,false);
assert.equal(call(db,'/onboarding/apply','POST', {...account(),snapshot:{...account().snapshot,locations:[{...account().snapshot.locations[0],currency:'USD'}]}}).status,409);
const t=db.prepare("SELECT id FROM receipt_templates WHERE purpose='customer'").get();
const current=templates(db,location(db)).find(x=>x.id===t.id);
db.prepare('INSERT INTO receipt_template_versions VALUES(?,?,?,?,?,?)').run(t.id,3,location(db),JSON.stringify({...current.config,footer:'This is my custom receipt.'}),'owner',new Date().toISOString());
db.prepare('UPDATE receipt_templates SET version=3 WHERE id=?').run(t.id);
assert.equal(call(db,'/onboarding/apply','POST',account('Noodle House (New Name)')).result.changed,true);
assert.equal(templates(db,location(db)).find(x=>x.id===t.id).version,3);
assert.equal(templates(db,location(db)).find(x=>x.id===t.id).config.businessName,'Noodle House');
db.prepare("INSERT INTO products VALUES(?,?,?,?,?)").run(randomUUID(),'Pad Thai','Noodles',15000,1);
assert.equal(call(db,'/onboarding').result.readiness.menu,true);
assert.equal(call(db,'/onboarding').result.readiness.counterSaleReady,false);
db.prepare("INSERT INTO shifts VALUES(?,NULL)").run(randomUUID());
assert.equal(call(db,'/onboarding').result.readiness.counterSaleReady,true);
assert.equal(normalizeWebsiteAccount(account()).source,'restaurant-ops-v3-site');
const occupied=fixture();
occupied.prepare('INSERT INTO products VALUES(?,?,?,?,?)').run(randomUUID(),'Existing Restaurant Item','Food',5000,1);
assert.equal(call(occupied,'/onboarding/preview','POST',account()).result.readiness.migrationRequired,true);
assert.equal(call(occupied,'/onboarding/apply','POST',account()).status,409);
assert.equal(occupied.prepare('SELECT count(*) AS n FROM restaurant_setup').get().n,0);
occupied.close();
db.close();
console.log('PASS website intake normalization, preview, persisted idempotent setup, owner-only access, tenant collision protection, currency guard, receipt versioning, custom receipt preservation and real readiness');
