import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {migrateExpenses,handleExpenses,expenseCategories} from '../expenses.mjs';

const db=new DatabaseSync(':memory:');
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE shifts(id TEXT PRIMARY KEY,opened_at TEXT,closed_at TEXT);
CREATE TABLE shift_cash_movements(id TEXT PRIMARY KEY,shift_id TEXT REFERENCES shifts(id),direction TEXT,amount INTEGER,description TEXT,place TEXT,recorded_by TEXT,created_at TEXT);
`);
migrateExpenses(db);
const owner={id:'owner',role:'Owner'},cashier={id:'cashier',role:'Cashier'};
const call=(route,method='GET',b,actor=owner)=>{
 let status,data;const res={writeHead(code){status=code},end(str){data=JSON.parse(str)}},
 send=(r,code,body)=>{r.writeHead(code);r.end(JSON.stringify(body));};
 try{handleExpenses({db,p:route.split('?')[0],url:new URL(route,'http://localhost'),method,b,user:actor,res,send});return{status,data};}
 catch(e){return{status:e.status||500,error:e.message};}
};
const range='?from=2026-10-01&to=2026-11-30';
assert.equal(call('/expenses/categories','GET',null,cashier).status,403);
assert(expenseCategories.includes('Packaging & Disposables'));
const shift=randomUUID(),cashOut=randomUUID(),transfer=randomUUID();
db.prepare('INSERT INTO shifts VALUES(?,?,?)').run(shift,'2026-10-31T12:00:00Z','2026-10-31T23:00:00Z');
const out=db.prepare('INSERT INTO shift_cash_movements VALUES(?,?,?,?,?,?,?,?)');
out.run(cashOut,shift,'out',90000,'Supplier food stock','Makro','staff','2026-10-31T23:00:00Z');
out.run(transfer,shift,'out',300000,'Owner money out','Owner','staff','2026-10-31T23:00:00Z');
out.run(randomUUID(),shift,'in',50000,'Money in','Safe','staff','2026-10-31T23:00:00Z');
assert.equal(call('/expenses'+range).data.shift.length,2);
assert.equal(call('/expenses'+range).data.totals.shift_confirmed_business,0,'Unclassified cash out cannot be counted as expense');
assert.equal(call('/expenses/shift/'+cashOut,'PATCH',{classification:'business',category:'Food & Beverage'}).status,200);
assert.equal(call('/expenses/shift/'+transfer,'PATCH',{classification:'transfer'}).status,200);
assert.equal(call('/expenses'+range).data.totals.shift_confirmed_business,90000);
const entered=call('/expenses','POST',{supplier:'MEG Supplies',category:'Packaging & Disposables',description:'Burger wrapping',amountMinor:240050,receiptDate:'2026-10-25',paymentMethod:'Bank transfer'});
assert.equal(entered.status,201,entered.error);
assert.equal(call('/expenses'+range).data.totals.external_business,240050);
assert.equal(call('/expenses/'+entered.data.id,'PATCH',{classification:'personal'}).status,200);
assert.equal(call('/expenses'+range).data.totals.external_business,0,'Personal must not enter business totals');
assert.equal(call('/expenses'+range).data.totals.external_excluded_personal,240050);
assert.equal(call('/expenses/'+entered.data.id,'PATCH',{classification:'business',category:'Equipment'}).status,200);
assert.equal(call('/expenses'+range).data.totals.total_confirmed_business,330050);
assert.equal(call('/expenses','POST',{supplier:'X',category:'Personal',description:'Personal',amountMinor:500,receiptDate:'2026-10-25',paymentMethod:'Bank transfer'}).status,400);
assert.equal(call('/expenses','POST',{supplier:'X',category:'Food & Beverage',description:'X',amountMinor:4.1,receiptDate:'2026-10-25',paymentMethod:'Bank transfer'}).status,400);
const statement={filename:'october.csv',rows:[
 {postedAt:'2026-10-10',description:'MAKRO Phuket',amountMinor:75000,direction:'outflow',reference:'mk10'},
 {postedAt:'2026-10-17',description:'MAKRO Phuket',amountMinor:71000,direction:'outflow',reference:'mk17'},
 {postedAt:'2026-10-17',description:'SUPER CHEAP Food',amountMinor:45000,direction:'outflow',reference:'sc17'},
 {postedAt:'2026-10-18',description:'Personal payment',amountMinor:3500,direction:'outflow',reference:'pers'},
 {postedAt:'2026-10-18',description:'Bank transfer between accounts',amountMinor:100000,direction:'outflow',reference:'trans'},
 {postedAt:'2026-10-18',description:'Customer payment',amountMinor:25000,direction:'inflow',reference:'deposit'}
]};
const first=call('/expenses/bank-import','POST',statement);
assert.equal(first.status,201,first.error);assert.equal(first.data.inserted,6);
const again=call('/expenses/bank-import','POST',statement);
assert.equal(again.data.inserted,0);assert.equal(again.data.duplicates,6);
let review=call('/expenses/bank-review'+range).data.transactions;
assert.equal(review.length,6);
assert.equal(review.filter(x=>x.supplier==='Makro').length,2);
assert(review.filter(x=>x.supplier==='Makro').every(x=>x.repeat_supplier),'Repeat supplier must flag');
const makro=review.find(x=>x.description==='MAKRO Phuket');
assert.equal(makro.category,'Food & Beverage');
assert.equal(call('/expenses/bank-review/'+makro.id,'PATCH',{classification:'business',supplier:'Makro',category:'Food & Beverage',purpose:'Raw ingredients',learnRule:true}).status,200);
assert.equal(call('/expenses/bank-review/'+makro.id,'PATCH',{classification:'business',category:'Food & Beverage'}).status,409,'Bank approval not repeatable');
assert.equal(call('/expenses/suggest?supplier=MAKRO%20Phuket').data.source,'learned');
const linked=db.prepare('SELECT * FROM business_expenses WHERE bank_transaction_id=?').get(makro.id);
assert.equal(linked.amount_minor,makro.amount_minor);
assert.equal(linked.payment_method,'Bank statement');
assert.equal(call('/expenses/bank-review'+range).data.transactions.find(x=>x.id===makro.id).classification,'business');
assert.equal(call('/expenses/'+linked.id,'PATCH',{classification:'personal'}).status,200);
assert.equal(call('/expenses/bank-review'+range).data.transactions.find(x=>x.id===makro.id).classification,'personal');
const personal=review.find(x=>x.description==='Personal payment'),transferRow=review.find(x=>x.description==='Bank transfer between accounts');
assert.equal(call('/expenses/bank-review/'+personal.id,'PATCH',{classification:'personal'}).status,200);
assert.equal(call('/expenses/bank-review/'+transferRow.id,'PATCH',{classification:'transfer'}).status,200);
assert.equal(call('/expenses/bank-review/'+review.find(x=>x.direction==='inflow').id,'PATCH',{classification:'business',category:'Food & Beverage'}).status,409);
assert.equal(db.prepare('SELECT count(*) n FROM expense_audit').get().n>0,true);
assert.throws(()=>db.prepare('DELETE FROM expense_audit').run(),/immutable/);
const possible=call('/expenses/bank-import','POST',{filename:'more.csv',rows:[
 {postedAt:'2026-10-25',description:'MEG Supplies other bank',amountMinor:240050,direction:'outflow',reference:'manual-match'}
]});
assert.equal(possible.status,201);
const duplicateBank=call('/expenses/bank-review'+range).data.transactions.find(x=>x.description==='MEG Supplies other bank');
assert.equal(duplicateBank.possible_matches.length,1);
assert.equal(call('/expenses/bank-review/'+duplicateBank.id,'PATCH',{classification:'business',category:'Equipment'}).status,409,'No silent duplicate ledger insertion');
assert.equal(call('/expenses/bank-review/'+duplicateBank.id,'PATCH',{classification:'duplicate'}).status,200);
const totals=call('/expenses'+range).data.totals;
assert.equal(totals.total_confirmed_business,330050,'Bank expense excluded as personal without deleting audit');
db.close();
console.log('PASS shift expense/transfer review, external cash-safe expense, personal exclusion, categories, statement dedupe, repeat suppliers, Makro/Super Cheap suggestions, learned rules, bank review, idempotency and immutable audit.');
