// V5 shift analytics — Manager/Owner reconciliation, no transaction mutations.
import {shiftCostSummary} from './sales-costs.mjs';
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
const num=v=>Number(v||0);
const dateOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
const timestamp=v=>new Date(v+'T00:00:00+07:00').toISOString();
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
 return {...shift,gross_sales:gross,discounts,refunds,net_sales:net,order_count:o.reduce((a,x)=>a+x.receipts,0),tenders,money_in:num(moneyIn),money_out:num(moneyOut),expected_cash:expectedCash,variance,status:shift.closed_at==null?'open':variance===0?'balanced':'difference',...shiftCostSummary(db,shift.id),profitability_available:false};
};
export function handleShiftAnalytics(url,method,res,db,user){
 const p=url.pathname.replace(/^\/(?:v5|v5-test)\/api(?=\/|$)/,'');
 if(!p.startsWith('/shift-analytics'))return false;
 if(!['Owner','Manager'].includes(user.role)){json(res,403,{message:'Manager or Owner access is required.'});return true;}
 if(method!=='GET'){json(res,405,{message:'Shift reports are read-only.'});return true;}
 try{
  if(p==='/shift-analytics'){
   const from=url.searchParams.get('from'),to=url.searchParams.get('to');
   if((from||to)&&(!dateOk(from)||!dateOk(to)||from>to))return json(res,400,{message:'Choose a valid range of shift opening dates.'}),true;
   // Recent view sorts by closure, so a shift closing today is visible even if it opened yesterday.
   const entries=from&&to?db.prepare("SELECT * FROM shifts WHERE opened_at>=? AND opened_at<? ORDER BY opened_at DESC LIMIT 500").all(timestamp(from),new Date(Date.parse(timestamp(to))+86400000).toISOString()):db.prepare("SELECT * FROM shifts ORDER BY coalesce(closed_at,opened_at) DESC LIMIT 100").all();
   json(res,200,{timezone:'Asia/Bangkok',basis:from?'shift_opening_date':'recent_activity',shifts:entries.map(s=>summary(db,s))});return true;
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
