import { randomUUID } from 'node:crypto';

const TZ_OFFSET = 7 * 60 * 60 * 1000; // Asia/Bangkok has no daylight-saving time.
const isLocalDateTime=s=>/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(s||''))&&Number.isFinite(Date.parse(s+'+07:00'))&&new Date(Date.parse(s+'+07:00')+TZ_OFFSET).toISOString().slice(0,16)===s;
const isDay = s => { if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return false;const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)===s; };
const ymd = d => new Date(d.getTime() + TZ_OFFSET).toISOString().slice(0, 10);
const asUtc = (date, end = false) => new Date(Date.parse(date + (end ? 'T00:00:00+07:00' : 'T00:00:00+07:00'))).toISOString();

export function migrateReporting(db) {
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(x => x.name);
  if (!cols('orders').includes('discount_total')) db.exec('ALTER TABLE orders ADD COLUMN discount_total INTEGER NOT NULL DEFAULT 0 CHECK(discount_total>=0)');
  if (!cols('refunds').includes('payment_method')) db.exec('ALTER TABLE refunds ADD COLUMN payment_method TEXT');
  if (!cols('order_items').includes('category')) db.exec('ALTER TABLE order_items ADD COLUMN category TEXT');
  if (!cols('order_items').includes('discount_amount')) db.exec('ALTER TABLE order_items ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK(discount_amount>=0)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS discounts(
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
      amount INTEGER NOT NULL CHECK(amount>0), reason TEXT NOT NULL,
      created_at TEXT NOT NULL, staff_id TEXT NOT NULL REFERENCES users(id),
      approved_by TEXT NOT NULL REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_shift_time ON orders(shift_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
    CREATE INDEX IF NOT EXISTS idx_discounts_order ON discounts(order_id);
  `);
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
  if (!usersSql.includes("'Owner'")) {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE users_reporting_new(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('Cashier','Manager','Owner')),salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER DEFAULT 1)`);
      db.exec('INSERT INTO users_reporting_new SELECT id,username,role,salt,password_hash,active FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_reporting_new RENAME TO users');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    db.exec('PRAGMA foreign_keys=ON');
  }
}

function bounds(params) {
  if (params.get('shiftId')) return { shiftId: params.get('shiftId') };
  const period = params.get('period') || 'today';
  const today = ymd(new Date());
  let from, to;
  if (period === 'custom') {
    const start=params.get('fromTime'),end=params.get('toTime');
    if(start||end){if(!isLocalDateTime(start)||!isLocalDateTime(end)||start>=end)throw Object.assign(new Error('Choose a valid start and end date and time.'),{status:400});return {from:new Date(start+'+07:00').toISOString(),to:new Date(end+'+07:00').toISOString(),shiftBasis:params.get('basis')==='shift'};}
    from = params.get('from'); to = params.get('to');
    if (!isDay(from) || !isDay(to) || from > to) throw Object.assign(new Error('Choose a valid date range.'), {status:400});
  } else if (period === 'yesterday') {
    const d = new Date(Date.parse(today + 'T00:00:00Z') - 86400000); from = to = d.toISOString().slice(0,10);
  } else if (period === '7d') {
    from = new Date(Date.parse(today + 'T00:00:00Z') - 6*86400000).toISOString().slice(0,10); to = today;
  } else if (period === 'month') { from = today.slice(0,7)+'-01'; to = today; }
  else if (period === 'lastMonth') {
    const d = new Date(Date.parse(today.slice(0,7)+'-01T00:00:00Z') - 86400000);
    from = d.toISOString().slice(0,7)+'-01'; to = d.toISOString().slice(0,10);
  } else if (period === 'today') from = to = today;
  else throw Object.assign(new Error('Choose a supported reporting period.'), {status:400});
  return {from:asUtc(from), to:asUtc(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)),shiftBasis:params.get('basis')==='shift'};
}
const whereOrders = r => r.shiftId ? {sql:'o.shift_id=?',args:[r.shiftId]} : r.shiftBasis ? {sql:'o.shift_id IN (SELECT id FROM shifts WHERE opened_at>=? AND opened_at<?)',args:[r.from,r.to]} : {sql:'o.created_at>=? AND o.created_at<?',args:[r.from,r.to]};
const rows = (db, sql, args) => db.prepare(sql).all(...args);
const cents = n => Number(n || 0);
const headers = (res, status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
function csv(res, filename, data) {
  const esc = x => '"' + String(x ?? '').replaceAll('"','""') + '"';
  const body = [data.columns.map(esc).join(','), ...data.rows.map(r=>data.columns.map(k=>esc(r[k])).join(','))].join('\r\n');
  res.writeHead(200, {'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'});
  res.end('\uFEFF'+body);
}
const reports = new Set(['overview','items','transactions','discounts','refunds','payments','shifts','channels']);

export function handleReporting(url, method, res, db, user) {
  const p = url.pathname.replace(/^\/(?:v5|v5-test)\/api(?=\/|$)/,'');
  if (!p.startsWith('/reports')) return false;
  if (user.role !== 'Owner') { headers(res,403,{message:'Owner access is required to view financial reports.'}); return true; }
  if (method !== 'GET') { headers(res,405,{message:'This report is read-only.'}); return true; }
  try {
    const filter=bounds(url.searchParams), w=whereOrders(filter), args=w.args;
    const completed = `(${w.sql}) AND o.status IN ('paid','refunded')`;
    const orders = rows(db,`SELECT o.*,s.opened_at AS shift_opened_at FROM orders o LEFT JOIN shifts s ON s.id=o.shift_id WHERE ${completed} ORDER BY o.created_at DESC`,args);
    const adjustmentWhere=filter.shiftId?{sql:'o.shift_id=?',args:[filter.shiftId]}:filter.shiftBasis?{sql:'o.shift_id IN (SELECT id FROM shifts WHERE opened_at>=? AND opened_at<?)',args:[filter.from,filter.to]}:{sql:'r.created_at>=? AND r.created_at<?',args:[filter.from,filter.to]};
    const refunds = rows(db,`SELECT r.*,o.receipt_number,o.created_at AS sale_at,o.payment_method AS sale_method,oi.name AS product_name,u.username AS approver FROM refunds r JOIN orders o ON o.id=r.order_id JOIN order_items oi ON oi.id=r.item_id LEFT JOIN users u ON u.username=r.approved_by WHERE ${adjustmentWhere.sql} ORDER BY r.created_at DESC`,adjustmentWhere.args);
    const discountWhere=filter.shiftId?{sql:'o.shift_id=?',args:[filter.shiftId]}:filter.shiftBasis?{sql:'o.shift_id IN (SELECT id FROM shifts WHERE opened_at>=? AND opened_at<?)',args:[filter.from,filter.to]}:{sql:'d.created_at>=? AND d.created_at<?',args:[filter.from,filter.to]};
    const discounts = rows(db,`SELECT d.*,o.receipt_number,st.username AS staff,ap.username AS approver,GROUP_CONCAT(DISTINCT oi.name) AS related_products FROM discounts d JOIN orders o ON o.id=d.order_id LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN users st ON st.id=d.staff_id LEFT JOIN users ap ON ap.id=d.approved_by WHERE ${discountWhere.sql} GROUP BY d.id ORDER BY d.created_at DESC`,discountWhere.args);
    const gross=orders.reduce((s,o)=>s+cents(o.subtotal),0), discount=orders.reduce((s,o)=>s+cents(o.discount_total),0), refund=refunds.reduce((s,r)=>s+cents(r.amount),0), net=gross-discount-refund;
    const itemRows=rows(db,`SELECT oi.product_id,oi.name,COALESCE(oi.category,'Category unavailable') AS category, SUM(oi.quantity) AS gross_quantity, SUM(oi.price*oi.quantity) AS gross_revenue, COALESCE(SUM(oi.discount_amount),0) AS discount_allocated, COALESCE(SUM((SELECT SUM(r.quantity) FROM refunds r WHERE r.item_id=oi.id)),0) AS refunded_quantity, COALESCE(SUM((SELECT SUM(r.amount) FROM refunds r WHERE r.item_id=oi.id)),0) AS refunded_value FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${completed} GROUP BY oi.product_id,oi.name,category ORDER BY gross_revenue DESC`,args).map(i=>({...i,net_quantity:i.gross_quantity-i.refunded_quantity,discount_allocated:Number(i.discount_allocated||0),net_revenue:i.gross_revenue-Number(i.discount_allocated||0)-i.refunded_value}));
    const channelSummary=Object.values(orders.reduce((map,o)=>{const id=o.channel_id||'in-store';const row=map[id]||(map[id]={channel_id:id,orders:0,gross_sales:0,discounts:0,refunds:0,net_sales:0});row.orders++;row.gross_sales+=cents(o.subtotal);row.discounts+=cents(o.discount_total);row.net_sales+=cents(o.subtotal)-cents(o.discount_total);return map},{}));
    for(const r of refunds){const id=db.prepare('SELECT channel_id FROM orders WHERE id=?').get(r.order_id)?.channel_id||'in-store';const row=channelSummary.find(x=>x.channel_id===id);if(row){row.refunds+=cents(r.amount);row.net_sales-=cents(r.amount)}}
    for(const row of channelSummary)row.name=db.prepare('SELECT name FROM sales_channels WHERE id=?').get(row.channel_id)?.name||row.channel_id;
    const paymentTotals={Cash:{count:0,total:0},QR:{count:0,total:0},Partner:{count:0,total:0}};
    for(const o of orders)if(paymentTotals[o.payment_method]){paymentTotals[o.payment_method].count++;paymentTotals[o.payment_method].total+=cents(o.total)-cents(o.discount_total);}
    for(const r of refunds)if(paymentTotals[r.payment_method])paymentTotals[r.payment_method].refunds=(paymentTotals[r.payment_method].refunds||0)+cents(r.amount);
    const shiftRows=rows(db,`SELECT s.*, (SELECT COALESCE(SUM(o.total-o.discount_total),0) FROM orders o WHERE o.shift_id=s.id AND o.status IN ('paid','refunded') AND o.payment_method='Cash') AS cash_sales,(SELECT COALESCE(SUM(o.total-o.discount_total),0) FROM orders o WHERE o.shift_id=s.id AND o.status IN ('paid','refunded') AND o.payment_method='QR') AS qr_sales,(SELECT COALESCE(SUM(r.amount),0) FROM refunds r WHERE r.payment_method='Cash' AND r.order_id IN (SELECT id FROM orders WHERE shift_id=s.id)) AS cash_refunds,(SELECT COALESCE(SUM(r.amount),0) FROM refunds r WHERE r.payment_method='QR' AND r.order_id IN (SELECT id FROM orders WHERE shift_id=s.id)) AS qr_refunds,(SELECT COALESCE(SUM(amount),0) FROM shift_cash_movements m WHERE m.shift_id=s.id AND direction='in') AS money_in,(SELECT COALESCE(SUM(amount),0) FROM shift_cash_movements m WHERE m.shift_id=s.id AND direction='out') AS money_out,(SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount ELSE -amount END),0) FROM shift_cash_movements m WHERE m.shift_id=s.id) AS net_movements FROM shifts s WHERE ${filter.shiftId?'s.id=?':'s.opened_at>=? AND s.opened_at<?'} ORDER BY s.opened_at DESC`,filter.shiftId?[filter.shiftId]:args).map(s=>({...s,expected_cash:Number(s.opening_cash)+Number(s.cash_sales)-Number(s.cash_refunds)+Number(s.net_movements),variance:s.closing_cash===null?null:Number(s.closing_cash)-(Number(s.opening_cash)+Number(s.cash_sales)-Number(s.cash_refunds)+Number(s.net_movements))}));
    const type=url.searchParams.get('type')||'overview';
    if(!reports.has(type))throw Object.assign(new Error('Choose a report type.'),{status:400});
    if(p.endsWith('/export')) {
      const map={channels:{columns:['name','orders','gross_sales','discounts','refunds','net_sales'],rows:channelSummary.map(c=>({...c,gross_sales:c.gross_sales/100,discounts:c.discounts/100,refunds:c.refunds/100,net_sales:c.net_sales/100}))},transactions:{columns:['receipt_number','created_at','shift_id','channel_id','partner_reference','partner_item_discount','partner_order_discount','status','payment_method','subtotal','discount_total','refund_total','total'],rows:orders.map(o=>({...o,subtotal:o.subtotal/100,discount_total:o.discount_total/100,partner_item_discount:(o.partner_item_discount||0)/100,partner_order_discount:(o.partner_order_discount||0)/100,refund_total:o.refund_total/100,total:(o.total-o.discount_total-o.refund_total)/100}))},
      items:{columns:['product_id','name','category','gross_quantity','refunded_quantity','net_quantity','gross_revenue','discount_allocated','refunded_value','net_revenue'],rows:itemRows.map(i=>({...i,gross_revenue:i.gross_revenue/100,discount_allocated:i.discount_allocated/100,refunded_value:i.refunded_value/100,net_revenue:i.net_revenue/100}))},
      discounts:{columns:['receipt_number','created_at','amount','reason','related_products','staff','approver'],rows:discounts.map(d=>({...d,amount:d.amount/100}))},
      refunds:{columns:['receipt_number','created_at','product_name','quantity','amount','reason','approver','payment_method'],rows:refunds.map(r=>({...r,amount:r.amount/100}))},
      payments:{columns:['method','count','payment_total','refund_adjustments'],rows:Object.entries(paymentTotals).map(([method,v])=>({method,count:v.count,payment_total:(v.total||0)/100,refund_adjustments:(v.refunds||0)/100}))},
      shifts:{columns:['id','opened_at','closed_at','opening_cash','cash_sales','qr_sales','cash_refunds','qr_refunds','money_in','money_out','net_movements','expected_cash','closing_cash','variance'],rows:shiftRows.map(s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,typeof v==='number'&&/cash|sales|refunds|movements|variance/.test(k)?v/100:v])))}}[type];
      csv(res,`v5-${type}.csv`,map); return true;
    }
    let data;
    if(type==='overview') data={timezone:'Asia/Bangkok',gross_sales:gross,discounts:discount,refunds:refund,net_sales:net,total_orders:orders.length,average_order_value:orders.length?Math.round(net/orders.length):0,cash_sales:paymentTotals.Cash.total,qr_sales:paymentTotals.QR.total,partner_sales:paymentTotals.Partner.total,channel_summary:channelSummary};
    else if(type==='channels')data=channelSummary;else if(type==='transactions') data=orders;
    else if(type==='items') data=itemRows;
    else if(type==='discounts') data=discounts;
    else if(type==='refunds') data=refunds;
    else if(type==='payments') data={methods:paymentTotals,corrections:rows(db,`SELECT pc.*,o.receipt_number FROM payment_corrections pc JOIN orders o ON o.id=pc.order_id WHERE ${filter.shiftId?'o.shift_id=?':filter.shiftBasis?'o.shift_id IN (SELECT id FROM shifts WHERE opened_at>=? AND opened_at<?)':'pc.created_at>=? AND pc.created_at<?'} ORDER BY pc.created_at DESC`,args)};
    else data=shiftRows;
    headers(res,200,{filter,data});
    return true;
  } catch(e) { headers(res,e.status||500,{message:e.status?e.message:'Reports could not be loaded. Refresh and try again.'}); return true; }
}
