import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migratePhaseOne,modifierRoutes} from '../phase1-order.mjs';
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE products(id TEXT PRIMARY KEY,active INTEGER);
CREATE TABLE order_items(id TEXT PRIMARY KEY);
CREATE TABLE orders(id TEXT PRIMARY KEY);
CREATE TABLE modifier_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,min_select INTEGER NOT NULL DEFAULT 0 CHECK(min_select>=0),max_select INTEGER NOT NULL DEFAULT 1 CHECK(max_select>=1 AND max_select<=30),active INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0,CHECK(min_select<=max_select));
CREATE TABLE modifier_options(id TEXT PRIMARY KEY,group_id TEXT REFERENCES modifier_groups(id),name TEXT NOT NULL,price_minor INTEGER CHECK(price_minor>=0),active INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0,UNIQUE(group_id,name));
INSERT INTO modifier_groups(id,name,min_select,max_select) VALUES('legacy','Legacy',1,2);
INSERT INTO modifier_options(id,group_id,name,price_minor) VALUES('legacy-option','legacy','Sauce',250);
`);
migratePhaseOne(db);migratePhaseOne(db);
assert.deepEqual({...db.prepare('SELECT min_select,max_select,max_unlimited FROM modifier_groups').get()},{min_select:1,max_select:2,max_unlimited:0});
assert.equal(db.prepare('SELECT default_quantity FROM modifier_options').get().default_quantity,1);
assert.equal(db.prepare('SELECT name FROM modifier_options').get().name,'Sauce');
db.exec("CREATE TRIGGER reject_bad_option BEFORE INSERT ON modifier_options WHEN NEW.name='Reject' BEGIN SELECT RAISE(ABORT,'simulated disk constraint'); END;");
let sent=false;
assert.throws(()=>modifierRoutes({db,p:'/modifier-groups',method:'POST',b:{name:'Atomic',minSelect:0,maxSelect:null,options:[{name:'First',priceMinor:100},{name:'Reject',priceMinor:200}]},user:{role:'Owner'},res:{},send:()=>{sent=true}}),/simulated disk constraint/);
assert(!sent);
assert.equal(db.prepare('SELECT COUNT(*) n FROM modifier_groups').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) n FROM modifier_options').get().n,1,'Storage failure rolls back the whole batch');
// Prior application SQL continues to read/write its original numeric columns after rollback.
db.prepare('UPDATE modifier_groups SET max_select=? WHERE id=?').run(3,'legacy');
assert.equal(db.prepare('SELECT max_select FROM modifier_groups WHERE id=?').get('legacy').max_select,3);
assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
db.close();
console.log('PASS additive repeatable migration, legacy data preserved, batch rollback on storage error, prior SQL compatibility');
