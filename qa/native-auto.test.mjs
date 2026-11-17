import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migratePrint,location,sampleOrder,snapshotPacking,enqueuePrint} from '../print-model.mjs';
const db=new DatabaseSync(':memory:');
try{
 migratePrint(db);
 db.exec('CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT);CREATE TABLE modifier_options(id TEXT PRIMARY KEY,group_id TEXT);');
 const loc=location(db);
 const policy={auto:{customer:true,kitchen:true,cashier:false},manual:{customer:true,kitchen:true,cashier:false},printerAssignments:{}};
 db.prepare('INSERT INTO print_policies VALUES (?,?,?,?)').run(loc,JSON.stringify(policy),new Date().toISOString(),'owner');
 db.prepare('INSERT INTO native_print_owner VALUES (?,?,?)').run(loc,'pos-tablet',new Date().toISOString());
 const order={...sampleOrder(),id:'grab-sale-1',channel_id:'GrabFood',partner_reference:'GRAB-123456',payment_method:'Partner'};
 snapshotPacking(db,order);
 enqueuePrint(db,order);
 enqueuePrint(db,order);
 const jobs=db.prepare('SELECT purpose,snapshot,status FROM native_auto_jobs ORDER BY purpose').all();
 assert.deepEqual(jobs.map(job=>job.purpose),['customer','kitchen']);
 assert.ok(jobs.every(job=>job.status==='queued'));
 assert.ok(jobs.every(job=>JSON.parse(job.snapshot).order.partner_reference==='GRAB-123456'));
 const snapshot=jobs[0].snapshot;
 db.prepare("UPDATE receipt_templates SET version=version+1 WHERE purpose='customer'").run();
 assert.equal(db.prepare("SELECT snapshot FROM native_auto_jobs WHERE purpose='customer'").get().snapshot,snapshot);
 console.log('PASS recorded Grab order queues exactly one saved customer and kitchen document');
}finally{db.close()}
