import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateShiftReconciliation,handleShiftReconciliation} from '../shift-reconciliation.mjs';
import {permitsStaffRequest} from '../staff-app-access.mjs';

function fixture(){const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE shifts(id TEXT PRIMARY KEY,opening_cash INTEGER NOT NULL,closing_cash INTEGER);
 CREATE TABLE sales_channels(id TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL,sort_order INTEGER NOT NULL);
 CREATE TABLE orders(id TEXT PRIMARY KEY,shift_id TEXT NOT NULL,channel_id TEXT,payment_method TEXT NOT NULL,total INTEGER NOT NULL,discount_total INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE TABLE refunds(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,payment_method TEXT NOT NULL,amount INTEGER NOT NULL);
 CREATE TABLE shift_cash_movements(id TEXT PRIMARY KEY,shift_id TEXT NOT NULL,direction TEXT NOT NULL,amount INTEGER NOT NULL);
 INSERT INTO shifts VALUES('night',10000,12000);
 INSERT INTO sales_channels VALUES('direct','Direct',1,0),('delivery','Delivery',1,1);
 INSERT INTO orders VALUES('cash','night','direct','Cash',10000,1000,'paid'),('partner','night','delivery','Partner',20000,0,'refunded');
 INSERT INTO refunds VALUES('refund','partner','Partner',2000);
 INSERT INTO shift_cash_movements VALUES('expense','night','out',1000);`);migrateShiftReconciliation(db);return db}
const staff={id:'staff',role:'Cashier',tenantId:'t',device:{locationId:'l'},permissions:new Set(['operations.closing.reconcile'])};
const owner={id:'owner',role:'Owner',tenantId:'t',device:{locationId:'l'},permissions:new Set(['operations.closing.reconcile','operations.closing.financial'])};
function call(db,user,path,method='GET',body={}){let result;handleShiftReconciliation(new URL('https://example.test/v5/api/shift-reconciliation'+path),method,{writeHead(status){result={status}},end(raw){result.body=JSON.parse(raw)}},db,user,body);return result}
const payload={channels:{direct:{count:1,minor:9000},delivery:{count:1,minor:18000}},methods:{Cash:{count:1,minor:9000},Partner:{count:1,minor:18000}},cashMinor:17000,bankMinor:1000,bankReference:'deposit-123'};

test('staff draft and submission remain blind; owner sees separate channel and tender totals',()=>{const db=fixture();
 const start=call(db,staff,'/night');assert.equal(start.status,200);assert.equal(start.body.available.channels.length,2);assert.equal(JSON.stringify(start.body).includes('expectedCash'),false);
 assert.equal(call(db,staff,'/night','PUT',payload).status,200);
 const blind=call(db,staff,'/night');assert.equal(JSON.stringify(blind.body).includes('expectedCash'),false);
 assert.equal(call(db,staff,'/night/report').status,403);
 assert.equal(call(db,staff,'/night/submit','POST',payload).status,200);
 assert.equal(call(db,staff,'/night','PUT',payload).status,409);
 const result=call(db,owner,'/night/report');assert.equal(result.status,200);
 assert.equal(result.body.system.expectedCashBeforeBankingMinor,18000);
 assert.equal(result.body.cashDifferenceMinor,0);
 assert.equal(result.body.system.channels.delivery.minor,18000);
 assert.equal(result.body.system.methods.Partner.minor,18000);
 assert.equal(result.body.system.methods.Cash.minor,9000);
 assert.equal(result.body.paymentDifference.Cash.minor,0);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('tenant and location isolate reconciliation, and submitted values are immutable',()=>{const db=fixture();call(db,staff,'/night/submit','POST',payload);
 assert.equal(call(db,owner,'').body.reconciliations.length,1);
 assert.equal(call(db,staff,'').status,403);
 const otherTenant={...owner,tenantId:'other'},otherLocation={...owner,device:{locationId:'other'}};
 assert.deepEqual(call(db,otherTenant,'').body.reconciliations,[]);
 assert.deepEqual(call(db,otherLocation,'').body.reconciliations,[]);
 assert.equal(call(db,otherTenant,'/night/report').status,404);
 assert.equal(call(db,otherLocation,'/night/report').status,404);
 assert.equal(call(db,staff,'/night/submit','POST',{...payload,cashMinor:1}).status,200);
 assert.equal(call(db,owner,'/night/report').body.staff.cashMinor,17000);
});
test('API gateway denies blind staff access to expected figures',()=>{
 const permissions=new Set(['applications.pos','operations.closing.reconcile']);
 const request=path=>permitsStaffRequest({permissions,mode:'POS',path,method:'GET',query:new URLSearchParams(),body:{}});
 assert.equal(request('/shift-reconciliation/night'),true);
 assert.equal(request('/shift-reconciliation/night/report'),false);
 assert.equal(request('/stock-control/variance/anything'),false);
 const kitchen=new Set(['applications.kds','operations.closing.checklist']);
 assert.equal(permitsStaffRequest({permissions:kitchen,mode:'KDS',path:'/stock-control/shift/s1',method:'GET',query:new URLSearchParams()}),true);
 assert.equal(permitsStaffRequest({permissions:kitchen,mode:'KDS',path:'/stock-control/variance/s1',method:'GET',query:new URLSearchParams()}),false);
 const countOnly=new Set(['applications.pos','operations.stock.count']);
 assert.equal(permitsStaffRequest({permissions:countOnly,mode:'POS',path:'/stock-control/items',method:'GET',query:new URLSearchParams()}),true);
 assert.equal(permitsStaffRequest({permissions:countOnly,mode:'POS',path:'/stock-control/variance/anything',method:'GET',query:new URLSearchParams()}),false);
 const approver=new Set(['applications.dashboard','operations.stock.approve']);
 assert.equal(permitsStaffRequest({permissions:approver,mode:'DASHBOARD',path:'/stock-control/requisitions/example/approve',method:'POST',query:new URLSearchParams()}),true);
});

test('location configuration disables blind sales submissions at the API',()=>{
 const db=fixture();db.exec("CREATE TABLE stock_settings(tenant_id TEXT,location_id TEXT,sales_enabled INTEGER); INSERT INTO stock_settings VALUES('t','l',0)");
 assert.equal(call(db,staff,'/night','PUT',payload).status,409);
 assert.equal(call(db,staff,'/night','GET').status,200);
 db.exec("INSERT INTO stock_settings VALUES('t','two',1)");
 assert.equal(call(db,{...staff,device:{locationId:'two'}},'/night','PUT',payload).status,200);
});
