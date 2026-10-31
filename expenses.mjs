// Customli V5 operating expenses. Isolated from POS cash/shift calculations.
import {randomUUID,createHash} from 'node:crypto';

export const expenseCategories=[
 'Food & Beverage','Packaging & Disposables','Cleaning & Hygiene','Utilities','Rent & Property',
 'Staff & Payroll','Repairs & Maintenance','Marketing & Advertising','Administration',
 'Software & Subscriptions','Bank & Merchant Fees','Equipment','Transport & Delivery',
 'Licences & Insurance','Professional Services','Other Business Expense'
];
export const expenseMethods=['Bank transfer','Business debit card','Business credit card','Cash outside register','Bank statement','Other'];
const categorySet=new Set(expenseCategories);
const isoDate=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const text=(v,max=200)=>String(v??'').trim().slice(0,max);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const sum=rows=>rows.reduce((a,r)=>a+Number(r.amount_minor||0),0);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const vendorSeed=[
 ['makro','Makro','Food & Beverage','Supplier purchases'],
 ['super cheap','Super Cheap','Food & Beverage','Supplier purchases'],
 ['supercheap','Super Cheap','Food & Beverage','Supplier purchases']
];
const writeAudit=(db,actor,action,entity,id,details)=>db.prepare('INSERT INTO expense_audit(id,actor_id,action,entity,entity_id,details,at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),actor,action,entity,id,JSON.stringify(details),new Date().toISOString());
function parseRange(url){
 const from=url.searchParams.get('from')||today().slice(0,8)+'01',to=url.searchParams.get('to')||today();
 if(!isoDate(from)||!isoDate(to)||from>to)fail(400,'Choose a valid expense date range.');
 return{from,to};
}
const rowGuid=v=>/^[0-9a-f-]{36}$/i.test(String(v||''))?String(v):null;
const money=v=>Number.isSafeInteger(v)&&v>0&&v<=1_000_000_000_00?v:null;
const requireCategory=v=>categorySet.has(v)?v:fail(400,'Choose a business expense category.');
const dateTimeFor=d=>new Date(d+'T00:00:00+07:00').toISOString();
const ensureTables=db=>db.exec(`
CREATE TABLE IF NOT EXISTS business_expenses(
 id TEXT PRIMARY KEY,receipt_date TEXT NOT NULL,supplier TEXT NOT NULL,category TEXT NOT NULL,
 description TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 payment_method TEXT NOT NULL,classification TEXT NOT NULL DEFAULT 'business'
 CHECK(classification IN('business','personal')),source TEXT NOT NULL CHECK(source IN('manual','bank')),
 bank_transaction_id TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 created_by TEXT NOT NULL,updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expense_date_idx ON business_expenses(receipt_date,classification);
CREATE TABLE IF NOT EXISTS expense_bank_batches(
 id TEXT PRIMARY KEY,filename TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_bank_transactions(
 id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES expense_bank_batches(id),
 posted_date TEXT NOT NULL,description TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 direction TEXT NOT NULL CHECK(direction IN('outflow','inflow')),
 reference TEXT NOT NULL,occurrence_index INTEGER NOT NULL,
 fingerprint TEXT NOT NULL UNIQUE,supplier TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',
 purpose TEXT NOT NULL DEFAULT '',classification TEXT NOT NULL DEFAULT 'review'
 CHECK(classification IN('review','business','personal','transfer','deposit','duplicate')),
 expense_id TEXT,reviewed_at TEXT,reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS bank_review_idx ON expense_bank_transactions(classification,posted_date);
CREATE TABLE IF NOT EXISTS expense_supplier_rules(
 id TEXT PRIMARY KEY,match_text TEXT UNIQUE NOT NULL,supplier TEXT NOT NULL,
 category TEXT NOT NULL,purpose TEXT NOT NULL,created_by TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shift_expense_reviews(
 movement_id TEXT PRIMARY KEY REFERENCES shift_cash_movements(id),
 classification TEXT NOT NULL CHECK(classification IN('business','personal','transfer')),
 category TEXT NOT NULL,reviewed_by TEXT NOT NULL,reviewed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_audit(
 id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,
 entity TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS expense_audit_no_update BEFORE UPDATE ON expense_audit
 BEGIN SELECT RAISE(ABORT,'Expense audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS expense_audit_no_delete BEFORE DELETE ON expense_audit
 BEGIN SELECT RAISE(ABORT,'Expense audit records are immutable'); END;`);
export function migrateExpenses(db){ensureTables(db);}
function suggestions(db,description){
 const v=text(description,250).toLowerCase();
 const rules=db.prepare('SELECT match_text,supplier,category,purpose FROM expense_supplier_rules ORDER BY length(match_text) DESC').all();
 const matches=rules.find(r=>v.includes(r.match_text));
 if(matches)return {...matches,source:'learned'};
 const known=vendorSeed.find(([term])=>v.includes(term));
 return known?{supplier:known[1],category:known[2],purpose:known[3],source:'suggested'}:
 {supplier:'',category:'Other Business Expense',purpose:'',source:'none'};
}
function enrichBank(db,rows) {
 const all=db.prepare("SELECT posted_date,coalesce(nullif(supplier,''),description) merchant FROM expense_bank_transactions WHERE direction='outflow'").all();
 const countByName=new Map();
 for(const x of all){
  const name=x.merchant.toLowerCase().replace(/[^a-z0-9\u0e00-\u0e7f ]/g,'').replace(/\s+/g,' ').trim().slice(0,40);
  if(!countByName.has(name))countByName.set(name,new Set());
  countByName.get(name).add(x.posted_date);
 }
 const possible=db.prepare(`SELECT id,supplier,receipt_date,category FROM business_expenses
    WHERE source='manual' AND classification='business' AND amount_minor=?
    AND receipt_date BETWEEN date(?,'-3 days') AND date(?,'+3 days') LIMIT 4`);
 return rows.map(row=>{
  const inferred=suggestions(db,row.description);
  const supplier=row.supplier||inferred.supplier,category=row.category||inferred.category,purpose=row.purpose||inferred.purpose;
  const name=(supplier||row.description).toLowerCase().replace(/[^a-z0-9\u0e00-\u0e7f ]/g,'').replace(/\s+/g,' ').trim().slice(0,40);
  const count=countByName.get(name)?.size||0;
  return {...row,supplier,category,purpose,suggestion_source:inferred.source,repeat_supplier:count>=2,matching_dates:count,possible_matches:row.direction==='outflow'?possible.all(row.amount_minor,row.posted_date,row.posted_date):[]};
 });
}
const output=(res,send,status,data)=>send(res,status,data);
export function handleExpenses({db,p,url,method,b,user,res,send}) {
 if(!p.startsWith('/expenses'))return null;
 if(user.role!=='Owner')fail(403,'Only an Owner can review business expenses.');
 const read=method==='GET',write=method==='POST',patch=method==='PATCH';
 if(p==='/expenses/categories'&&read)return output(res,send,200,{categories:expenseCategories,paymentMethods:expenseMethods});
 if(p==='/expenses/suggest'&&read)return output(res,send,200,suggestions(db,url.searchParams.get('supplier')));
 if(p==='/expenses'&&read){
  const{from,to}=parseRange(url);
  const business=db.prepare('SELECT * FROM business_expenses WHERE receipt_date BETWEEN ? AND ? ORDER BY receipt_date DESC,created_at DESC').all(from,to);
  // Shift cash movements are facts from signed off shift reports. Only owner-reviewed
  // business outflows count as expenses; withdrawals and personal movements are not silently expensed.
  const shift=db.prepare(`SELECT m.id,m.shift_id,m.amount AS amount_minor,m.description,m.place AS supplier,m.created_at,
   substr(datetime(s.opened_at,'+7 hours'),1,10) AS receipt_date,r.classification,
   coalesce(r.category,'') AS category
   FROM shift_cash_movements m JOIN shifts s ON s.id=m.shift_id
   LEFT JOIN shift_expense_reviews r ON r.movement_id=m.id
   WHERE m.direction='out' AND substr(datetime(s.opened_at,'+7 hours'),1,10) BETWEEN ? AND ?
   ORDER BY s.opened_at DESC,m.created_at DESC`).all(from,to);
  const approvedBank=db.prepare("SELECT COUNT(*) n FROM expense_bank_transactions WHERE classification='business'").get().n;
  return output(res,send,200,{
   range:{from,to},shift,external:business,
   totals:{shift_cash_outflows:sum(shift),shift_confirmed_business:sum(shift.filter(x=>x.classification==='business')),
    external_business:sum(business.filter(x=>x.classification==='business')),
    external_excluded_personal:sum(business.filter(x=>x.classification==='personal')),
    total_confirmed_business:sum(shift.filter(x=>x.classification==='business'))+sum(business.filter(x=>x.classification==='business')),
    approved_bank_transactions:approvedBank}
  });
 }
 if(p==='/expenses'&&write){
  const supplier=text(b.supplier,120),description=text(b.description,500),date=b.receiptDate,amount=money(b.amountMinor),
   category=requireCategory(b.category),payment=text(b.paymentMethod,60);
  if(!supplier||!description||!isoDate(date)||!amount||!expenseMethods.includes(payment))
   fail(400,'Enter receipt date, supplier, purpose, positive amount and payment method.');
  const id=randomUUID(),now=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('INSERT INTO business_expenses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,date,supplier,category,description,amount,payment,'business','manual',null,now,now,user.id,user.id);
   writeAudit(db,user.id,'expense.created','expense',id,{supplier,amount,category,payment});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return output(res,send,201,{id});
 }
 const expenseId=p.match(/^\/expenses\/([0-9a-f-]{36})$/i);
 if(expenseId&&patch){
  const old=db.prepare('SELECT * FROM business_expenses WHERE id=?').get(expenseId[1]);
  if(!old)fail(404,'Expense not found.');
  const next={
   receipt_date:b.receiptDate??old.receipt_date,supplier:text(b.supplier??old.supplier,120),
   category:b.category??old.category,description:text(b.description??old.description,500),
   amount_minor:b.amountMinor??old.amount_minor,payment_method:b.paymentMethod??old.payment_method,
   classification:b.classification??old.classification
  };
  if(!isoDate(next.receipt_date)||!next.supplier||!next.description||!money(next.amount_minor)||
    !categorySet.has(next.category)||!expenseMethods.includes(next.payment_method)||
    !['business','personal'].includes(next.classification))fail(400,'Check expense details and business/personal classification.');
  // Posted bank transactions retain their original amount/date: corrections are explicit source adjustments, not silent bank edits.
  if(old.source==='bank'&&(next.amount_minor!==old.amount_minor||next.receipt_date!==old.receipt_date))
   fail(409,'Bank transaction amount/date cannot be changed. Adjust the source statement instead.');
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare(`UPDATE business_expenses SET receipt_date=?,supplier=?,category=?,description=?,
    amount_minor=?,payment_method=?,classification=?,updated_by=?,updated_at=? WHERE id=?`)
    .run(next.receipt_date,next.supplier,next.category,next.description,next.amount_minor,
     next.payment_method,next.classification,user.id,new Date().toISOString(),old.id);
   if(old.bank_transaction_id&&next.classification!==old.classification)
    db.prepare('UPDATE expense_bank_transactions SET classification=?,reviewed_by=?,reviewed_at=? WHERE id=?')
     .run(next.classification,user.id,new Date().toISOString(),old.bank_transaction_id);
   writeAudit(db,user.id,'expense.updated','expense',old.id,{from:{classification:old.classification,category:old.category,amount_minor:old.amount_minor},to:next});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return output(res,send,200,{ok:true});
 }
 const shiftId=p.match(/^\/expenses\/shift\/([0-9a-f-]{36})$/i);
 if(shiftId&&patch){
  const row=db.prepare("SELECT id FROM shift_cash_movements WHERE id=? AND direction='out'").get(shiftId[1]);
  if(!row)fail(404,'Shift money-out record not found.');
  if(!['business','personal','transfer'].includes(b.classification))fail(400,'Choose business, personal or transfer.');
  const category=b.classification==='business'?requireCategory(b.category):'';
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare(`INSERT INTO shift_expense_reviews VALUES(?,?,?,?,?)
    ON CONFLICT(movement_id) DO UPDATE SET classification=excluded.classification,category=excluded.category,
    reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
    .run(row.id,b.classification,category,user.id,new Date().toISOString());
   writeAudit(db,user.id,'shift_outflow.classified','shift_outflow',row.id,{classification:b.classification,category});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return output(res,send,200,{ok:true});
 }
 if(p==='/expenses/bank-import'&&write){
  if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>1500)fail(400,'Choose a CSV statement with 1–1500 transactions.');
  const filename=text(b.filename,150);
  if(!/\.csv$/i.test(filename))fail(400,'Choose a CSV statement exported by your bank.');
  const batchId=randomUUID(),seen=new Map();
  const data=b.rows.map(row=>{
   const posted=row.postedAt,description=text(row.description,350),amount=money(row.amountMinor),
    direction=row.direction,reference=text(row.reference,120);
   if(!isoDate(posted)||!description||!amount||!['outflow','inflow'].includes(direction))
    fail(400,'Statement rows need date, description, positive amount and debit/credit direction.');
   const base=[posted,description.toLowerCase().replace(/\s+/g,' '),amount,direction,reference.toLowerCase()].join('|');
   const occurrence=(seen.get(base)||0)+1;seen.set(base,occurrence);
   return {posted,description,amount,direction,reference,occurrence,
    fingerprint:createHash('sha256').update(base+'|'+occurrence).digest('hex')};
  });
  let inserted=0,duplicates=0;
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('INSERT INTO expense_bank_batches VALUES(?,?,?,?)').run(batchId,filename,new Date().toISOString(),user.id);
   const stmt=db.prepare(`INSERT OR IGNORE INTO expense_bank_transactions
     (id,batch_id,posted_date,description,amount_minor,direction,reference,occurrence_index,fingerprint,
     supplier,category,purpose,classification) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
   for(const row of data){
    const suggestion=suggestions(db,row.description);
    const v=stmt.run(randomUUID(),batchId,row.posted,row.description,row.amount,row.direction,row.reference,
     row.occurrence,row.fingerprint,suggestion.supplier,suggestion.category,suggestion.purpose,
     row.direction==='inflow'?'deposit':'review');
    if(v.changes)inserted++;else duplicates++;
   }
   writeAudit(db,user.id,'bank.imported','bank_batch',batchId,{filename,inserted,duplicates,totalRows:data.length});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return output(res,send,201,{batchId,inserted,duplicates});
 }
 if(p==='/expenses/bank-review'&&read){
  const {from,to}=parseRange(url);
  const rows=db.prepare(`SELECT * FROM expense_bank_transactions
   WHERE posted_date BETWEEN ? AND ? ORDER BY posted_date DESC,description LIMIT 5000`).all(from,to);
  return output(res,send,200,{transactions:enrichBank(db,rows)});
 }
 const matchBank=p.match(/^\/expenses\/bank-review\/([0-9a-f-]{36})$/i);
 if(matchBank&&patch){
  const row=db.prepare('SELECT * FROM expense_bank_transactions WHERE id=?').get(matchBank[1]);
  if(!row)fail(404,'Bank transaction not found.');
  if(row.classification!=='review')fail(409,'This bank transaction has already been reviewed. Edit its linked expense to exclude personal purchases.');
  const choice=b.classification;
  if(!['business','personal','transfer','duplicate'].includes(choice))fail(400,'Choose business, personal, transfer or duplicate.');
  if(choice==='business'&&row.direction!=='outflow')fail(409,'Only bank withdrawals may be recorded as expenses.');
  const supplier=text(b.supplier??row.supplier,120)||text(row.description,120);
  const category=choice==='business'?requireCategory(b.category):'';
  const description=text(b.purpose??row.purpose??row.description,500)||row.description;
  if(choice==='business'&&!b.allowDuplicate){
   const matches=db.prepare(`SELECT id,supplier,receipt_date FROM business_expenses
    WHERE source='manual' AND classification='business' AND amount_minor=?
    AND receipt_date BETWEEN date(?,'-3 days') AND date(?,'+3 days') LIMIT 3`).all(row.amount_minor,row.posted_date,row.posted_date);
   if(matches.length)fail(409,'An expense with the same amount and nearby date was already entered manually. Review it before recording another.');
  }
  const expenseId=choice==='business'?randomUUID():null;
  db.exec('BEGIN IMMEDIATE');
  try{
   if(expenseId)db.prepare('INSERT INTO business_expenses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(expenseId,row.posted_date,supplier,category,description,row.amount_minor,'Bank statement','business',
     'bank',row.id,new Date().toISOString(),new Date().toISOString(),user.id,user.id);
   db.prepare(`UPDATE expense_bank_transactions SET classification=?,supplier=?,category=?,purpose=?,
    expense_id=?,reviewed_at=?,reviewed_by=? WHERE id=?`)
    .run(choice,supplier,category,description,expenseId,new Date().toISOString(),user.id,row.id);
   if(expenseId&&b.learnRule){
    const match=text(b.matchText||supplier,100).toLowerCase();
    if(match.length>=3)
     db.prepare(`INSERT INTO expense_supplier_rules VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(match_text) DO UPDATE SET supplier=excluded.supplier,category=excluded.category,
      purpose=excluded.purpose,created_by=excluded.created_by,updated_at=excluded.updated_at`)
      .run(randomUUID(),match,supplier,category,description,user.id,new Date().toISOString());
   }
   writeAudit(db,user.id,'bank.reviewed','bank_transaction',row.id,{choice,expenseId,category,supplier,learnRule:Boolean(b.learnRule)});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return output(res,send,200,{ok:true,expenseId,classification:choice});
 }
 fail(404,'Expense action not found.');
}
