// V5 shift analytics — Manager/Owner reconciliation, no transaction mutations.
import {randomUUID} from 'node:crypto';
import {shiftCostSummary} from './sales-costs.mjs';
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
const num=v=>Number(v||0);
const dateOk=v=>{const value=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value};
const timestamp=v=>new Date(v+'T00:00:00+07:00').toISOString();
function ensureSignoffTables(db){
 db.exec(`CREATE TABLE IF NOT EXISTS shift_signoffs(
  shift_id TEXT PRIMARY KEY REFERENCES shifts(id),
  staff_count INTEGER NOT NULL CHECK(staff_count BETWEEN 1 AND 99),
  staff_hours REAL NOT NULL CHECK(staff_hours BETWEEN 0 AND 1000),
  labor_cost_minor INTEGER NOT NULL CHECK(labor_cost_minor BETWEEN 0 AND 100000000000),
  incident INTEGER NOT NULL CHECK(incident IN(0,1)),
  incident_notes TEXT NOT NULL DEFAULT '',
  follow_up INTEGER NOT NULL CHECK(follow_up IN(0,1)),
  follow_up_notes TEXT NOT NULL DEFAULT '',
  finalized_by TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
 );
 CREATE TABLE IF NOT EXISTS shift_signoff_audit(
  id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES shifts(id),
  actor_id TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL
 );
 CREATE TRIGGER IF NOT EXISTS shift_signoff_audit_no_update BEFORE UPDATE ON shift_signoff_audit
  BEGIN SELECT RAISE(ABORT,'Shift sign-off audit is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS shift_signoff_audit_no_delete BEFORE DELETE ON shift_signoff_audit
  BEGIN SELECT RAISE(ABORT,'Shift sign-off audit is immutable'); END;`);
}
const summary=(db,shift)=>{
 const o=db.prepare("SELECT o.payment_method, count(*) receipts, coalesce(sum(o.subtotal),0) gross, coalesce(sum(o.discount_total),0) discounts, coalesce(sum(o.total-o.discount_total),0) tender FROM orders o WHERE o.shift_id=? AND o.status IN ('paid','refunded') GROUP BY o.payment_method").all(shift.id);
 const r=db.prepare("SELECT r.payment_method, coalesce(sum(r.amount),0) refund_amount FROM refunds r JOIN orders o ON o.id=r.order_id WHERE o.shift_id=? GROUP BY r.payment_method").all(shift.id);
 const movements=db.prepare("SELECT direction, coalesce(sum(amount),0) amount FROM shift_cash_movements WHERE shift_id=? GROUP BY direction").all(shift.id);
 const tenders=Object.fromEntries(o.map(x=>[x.payment_method,{orders:x.receipts,gross:num(x.gross),discounts:num(x.discounts),received:num(x.tender),refunds:0,net:num(x.tender)}]));
 for(const x of r){if(!tenders[x.payment_method])tenders[x.payment_method]={orders:0,gross:0,discounts:0,received:0,refunds:0,net:0};tenders[x.payment_method].refunds+=num(x.refund_amount);tenders[x.payment_method].net-=num(x.refund_amount);}
 const gross=Object.values(tenders).reduce((a,x)=>a+x.gross,0),discounts=Object.values(tenders).reduce((a,x)=>a+x.discounts,0),refunds=Object.values(tenders).reduce((a,x)=>a+x.refunds,0),net=gross-discounts-refunds;
 const moneyIn=movements.find(x=>x.direction==='in')?.amount||0,moneyOut=movements.find(x=>x.direction==='out')?.amount||0;
 const expectedCash=num(shift.opening_cash)+(tenders.Cash?.net||0)+num(moneyIn)-num(moneyOut);
 const variance=shift.closing_cash==null?null:num(shift.closing_cash)-expectedCash;
 const costs=shiftCostSummary(db,shift.id),signoff=db.prepare('SELECT * FROM shift_signoffs WHERE shift_id=?').get(shift.id);
 if(o.length===0&&costs.items_to_cost===0){costs.costs_available=true;costs.cogs_minor=0;}
 return {...shift,gross_sales:gross,discounts,refunds,net_sales:net,order_count:o.reduce((a,x)=>a+x.receipts,0),tenders,money_in:num(moneyIn),money_out:num(moneyOut),expected_cash:expectedCash,variance,status:shift.closed_at==null?'open':variance===0?'balanced':'difference',...costs,signoff:signoff||null,labor_cost_pct:signoff&&net>0?signoff.labor_cost_minor/net*100:null,sales_per_labor_hour:signoff&&signoff.staff_hours>0?net/signoff.staff_hours:null,prime_cost_minor:signoff&&costs.costs_available?signoff.labor_cost_minor+costs.cogs_minor:null,prime_cost_pct:signoff&&costs.costs_available&&net>0?(signoff.labor_cost_minor+costs.cogs_minor)/net*100:null,profitability_available:false};
};
export function handleShiftAnalytics(url,method,res,db,user,b={}){
 const p=url.pathname.replace(/^\/(?:v5|v5-test)\/api(?=\/|$)/,'');
 if(!p.startsWith('/shift-analytics'))return false;
 ensureSignoffTables(db);
 if(p==='/shift-analytics/signoff'){
  if(user.role!=='Owner'){json(res,403,{message:'Owner access is required to finalise shifts.'});return true;}
  if(method!=='POST'){json(res,405,{message:'Use POST to save a shift sign-off.'});return true;}
  try{
   const id=String(b.shift_id||'');
   if(!/^[0-9a-f-]{36}$/i.test(id)){json(res,400,{message:'Choose a valid shift.'});return true;}
   const shift=db.prepare('SELECT id,closed_at FROM shifts WHERE id=?').get(id);
   if(!shift){json(res,404,{message:'Shift not found.'});return true;}
   if(!shift.closed_at){json(res,409,{message:'Close the shift in POS before finalising it.'});return true;}
   const staffCount=Number(b.staff_count),staffHours=Number(b.staff_hours),laborCost=Number(b.labor_cost_minor);
   if(!Number.isInteger(staffCount)||staffCount<1||staffCount>99){json(res,400,{message:'Enter between 1 and 99 staff on duty.'});return true;}
   if(!Number.isFinite(staffHours)||staffHours<0||staffHours>1000){json(res,400,{message:'Enter valid total staff hours.'});return true;}
   if(!Number.isSafeInteger(laborCost)||laborCost<0||laborCost>100000000000){json(res,400,{message:'Enter a valid labour cost in satang.'});return true;}
   const incident=Boolean(b.incident),followUp=Boolean(b.follow_up);
   const incidentNotes=String(b.incident_notes||'').trim().slice(0,1000),followUpNotes=String(b.follow_up_notes||'').trim().slice(0,1000);
   if(incident&&!incidentNotes){json(res,400,{message:'Add a short note about the reported issue.'});return true;}
   if(followUp&&!followUpNotes){json(res,400,{message:'Add a short note describing the follow-up.'});return true;}
   const before=db.prepare('SELECT * FROM shift_signoffs WHERE shift_id=?').get(id);
   const now=new Date().toISOString(),after={shift_id:id,staff_count:staffCount,staff_hours:staffHours,labor_cost_minor:laborCost,incident:Number(incident),incident_notes:incidentNotes,follow_up:Number(followUp),follow_up_notes:followUpNotes,finalized_by:user.id,finalized_at:before?.finalized_at||now,updated_at:now,version:(before?.version||0)+1};
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('INSERT INTO shift_signoffs(shift_id,staff_count,staff_hours,labor_cost_minor,incident,incident_notes,follow_up,follow_up_notes,finalized_by,finalized_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shift_id) DO UPDATE SET staff_count=excluded.staff_count,staff_hours=excluded.staff_hours,labor_cost_minor=excluded.labor_cost_minor,incident=excluded.incident,incident_notes=excluded.incident_notes,follow_up=excluded.follow_up,follow_up_notes=excluded.follow_up_notes,finalized_by=excluded.finalized_by,updated_at=excluded.updated_at,version=excluded.version').run(after.shift_id,after.staff_count,after.staff_hours,after.labor_cost_minor,after.incident,after.incident_notes,after.follow_up,after.follow_up_notes,after.finalized_by,after.finalized_at,after.updated_at,after.version);
    db.prepare('INSERT INTO shift_signoff_audit(id,shift_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,user.id,before?'updated':'finalised',JSON.stringify({before:before||null,after}),now);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   json(res,200,{ok:true,signoff:after});return true;
  }catch(e){json(res,500,{message:'Shift sign-off could not be saved.'});return true;}
 }
 if(!['Owner','Manager'].includes(user.role)){json(res,403,{message:'Manager or Owner access is required.'});return true;}
 if(p==='/shift-analytics/margins'&&method==='GET'){
  try{
   const from=url.searchParams.get('from'),to=url.searchParams.get('to');
   if(!dateOk(from)||!dateOk(to)||from>to){json(res,400,{message:'Choose a valid date range for margin reporting.'});return true;}
   const start=timestamp(from),end=new Date(Date.parse(timestamp(to))+86400000).toISOString();
   const lines=db.prepare(`SELECT oi.id AS item_id,oi.name,oi.price,oi.quantity,oi.discount_amount,oi.partner_discount,o.id AS order_id,o.channel_id,o.discount_total,o.created_at,COALESCE(r.refund_amount,0) AS refund_amount,c.total_cost_minor,c.complete AS cost_complete
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    LEFT JOIN (SELECT item_id,SUM(amount) refund_amount FROM refunds GROUP BY item_id) r ON r.item_id=oi.id
    LEFT JOIN order_item_cost_snapshots c ON c.order_item_id=oi.id
    WHERE o.created_at>=? AND o.created_at<? AND o.status IN ('paid','refunded')
    ORDER BY o.id,oi.id`).all(start,end);
   const channels=new Map(db.prepare('SELECT id,name FROM sales_channels').all().map(x=>[x.id,x.name]));
   const byOrder=new Map();
   for(const line of lines){let o=byOrder.get(line.order_id);if(!o){o={discount:Number(line.discount_total||0),gross:0,lines:[]};byOrder.set(line.order_id,o);}const gross=Number(line.price||0)*Number(line.quantity||0);o.gross+=gross;o.lines.push({...line,gross});}
   const grouped={items:new Map(),channels:new Map()};
   for(const order of byOrder.values())for(const line of order.lines){
    const lineDiscount=Number(line.discount_amount||0);
    const revenue=Math.max(0,line.gross-lineDiscount-Number(line.refund_amount||0));
    const cogs=line.cost_complete===1?Number(line.total_cost_minor||0):null;
    const channel=channels.get(line.channel_id)||'Direct';
    for(const [map,key] of [[grouped.items,line.name||'Unnamed item'],[grouped.channels,channel]]){
     let g=map.get(key);if(!g){g={name:key,orders:new Set(),quantity:0,gross_sales_minor:0,net_sales_minor:0,cogs_minor:0,all_costed:true};map.set(key,g);}
     g.orders.add(line.order_id);g.quantity+=Number(line.quantity||0);g.gross_sales_minor+=line.gross;g.net_sales_minor+=revenue;
     if(cogs===null)g.all_costed=false;else g.cogs_minor+=cogs;
    }
   }
   const pack=map=>[...map.values()].map(x=>({name:x.name,orders:x.orders.size,quantity:x.quantity,gross_sales_minor:x.gross_sales_minor,net_sales_minor:x.net_sales_minor,costs_available:x.all_costed,cogs_minor:x.all_costed?x.cogs_minor:null,gross_margin_minor:x.all_costed?x.net_sales_minor-x.cogs_minor:null,gross_margin_pct:x.all_costed&&x.net_sales_minor>0?(x.net_sales_minor-x.cogs_minor)/x.net_sales_minor*100:null})).sort((a,b)=>b.gross_margin_minor-a.gross_margin_minor);
   const items=pack(grouped.items),channelRows=pack(grouped.channels);
   json(res,200,{from,to,timezone:'Asia/Bangkok',items,channels:channelRows,fee_note:'Gross margin subtracts recipe COGS only; channel commissions, payment fees and operating expenses are not included.'});return true;
  }catch(e){json(res,500,{message:'Gross margin data could not be loaded.'});return true;}
 }
 if(method!=='GET'){json(res,405,{message:'Shift reports are read-only.'});return true;}
 try{
  if(p==='/shift-analytics'){
   const from=url.searchParams.get('from'),to=url.searchParams.get('to'),basis=url.searchParams.get('basis')==='closed'?'closed':'opened';
   if((from||to)&&(!dateOk(from)||!dateOk(to)||from>to))return json(res,400,{message:'Choose a valid range of shift dates.'}),true;
   const column=basis==='closed'?'closed_at':'opened_at';
   const entries=from&&to?db.prepare('SELECT * FROM shifts WHERE '+column+'>=? AND '+column+'<? ORDER BY '+column+' DESC LIMIT 500').all(timestamp(from),new Date(Date.parse(timestamp(to))+86400000).toISOString()):db.prepare("SELECT * FROM shifts ORDER BY coalesce(closed_at,opened_at) DESC LIMIT 100").all();
   json(res,200,{timezone:'Asia/Bangkok',basis:from?basis+'_date':'recent_activity',shifts:entries.map(s=>summary(db,s))});return true;
  }
  if(p==='/shift-analytics/detail'){
   const id=url.searchParams.get('shiftId');
   if(!/^[0-9a-f-]{36}$/i.test(id||''))return json(res,400,{message:'Choose a shift.'}),true;
   const s=db.prepare('SELECT * FROM shifts WHERE id=?').get(id);
   if(!s)return json(res,404,{message:'Shift not found.'}),true;
   const shift=summary(db,s);
   const receipts=db.prepare("SELECT id,receipt_number,created_at,payment_method,mode,subtotal,discount_total,refund_total,total,status FROM orders WHERE shift_id=? AND status IN ('paid','refunded') ORDER BY created_at,receipt_number").all(id);
   const movements=db.prepare("SELECT direction,amount,description,place,recorded_by,created_at FROM shift_cash_movements WHERE shift_id=? ORDER BY created_at").all(id);
   const adjustments=db.prepare("SELECT r.created_at,r.amount,r.quantity,r.reason,r.payment_method,o.receipt_number,oi.name AS item_name FROM refunds r JOIN orders o ON r.order_id=o.id JOIN order_items oi ON oi.id=r.item_id WHERE o.shift_id=? ORDER BY r.created_at").all(id);
   const items=db.prepare("SELECT oi.name, sum(oi.quantity) quantity, sum(oi.quantity*oi.price) gross_sales FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.shift_id=? AND o.status IN ('paid','refunded') GROUP BY oi.name ORDER BY quantity DESC,oi.name").all(id);
   json(res,200,{timezone:'Asia/Bangkok',shift,receipts,movements,refunds:adjustments,items,costs_available:shift.costs_available,cogs_minor:shift.cogs_minor,gross_margin_minor:shift.costs_available?shift.net_sales-shift.cogs_minor:null,note:shift.costs_available?'Gross margin excludes operating expenses. Refunded food remains consumed unless stock is separately returned.':'Incomplete recipe or modifier costing; gross margin is not available.'});return true;
  }
  json(res,404,{message:'Shift report not found.'});return true;
 }catch(e){json(res,500,{message:'Shift report could not be loaded.'});return true;}
}
