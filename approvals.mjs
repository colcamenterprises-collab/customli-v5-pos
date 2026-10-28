import {randomUUID} from 'node:crypto';
export function installApprovals(db){
 db.exec(`CREATE TABLE IF NOT EXISTS approval_requests(id TEXT PRIMARY KEY,kind TEXT NOT NULL,order_id TEXT NOT NULL,item_id TEXT,quantity INTEGER,amount INTEGER NOT NULL,reason TEXT NOT NULL,payment_method TEXT,requested_by TEXT NOT NULL,approved_by TEXT,method TEXT,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,decided_at TEXT,completed_at TEXT,completed_by TEXT,expires_at TEXT NOT NULL);`);
}
export function approvalRoutes({db,p,method,b,user,send,res,bad,manager,getShift,authorize}){
 const now=()=>new Date().toISOString();const isApprover=['Owner','Manager'].includes(user.role);
 const record=(id)=>db.prepare('SELECT r.*,a.username AS requester_name,z.username AS approver_name FROM approval_requests r JOIN users a ON a.id=r.requested_by LEFT JOIN users z ON z.id=r.approved_by WHERE r.id=?').get(id);
 if(p==='/approvals'&&method==='GET'){const rows=db.prepare('SELECT id FROM approval_requests ORDER BY created_at DESC LIMIT 200').all().map(x=>record(x.id));return send(res,200,rows)}
 if(p==='/approvals'&&method==='POST'){
  if(!['refund','payment_correction'].includes(b.kind))bad(400,'Invalid approval type');
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(String(b.orderId||''));if(!order)bad(404,'Receipt not found');
  if(order.shift_id!==getShift()?.id)bad(409,'The original shift must be open to request a refund or correction');
  const reason=String(b.reason||'').trim();if(!reason||reason.length>500)bad(400,'Enter a reason');
  let itemId=null,qty=null,amount=0,paymentMethod=String(b.paymentMethod||'');
  if(!['Cash','QR'].includes(paymentMethod))bad(400,'Choose Cash or QR');
  if(b.kind==='refund'){
   const item=db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').get(String(b.itemId||''),order.id);if(!item)bad(404,'Receipt item not found');
   qty=Number(b.quantity);const used=db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM refunds WHERE item_id=?').get(item.id).n;
   if(!Number.isSafeInteger(qty)||qty<1||qty>item.quantity-used)bad(409,'Quantity exceeds refundable items');
   const net=item.price*item.quantity-Number(item.discount_amount||0);amount=Math.floor(net*(used+qty)/item.quantity)-Math.floor(net*used/item.quantity);
   if(amount>order.total-order.discount_total-order.refund_total)bad(409,'Refund exceeds remaining amount');itemId=item.id;
  }else{if(paymentMethod===order.payment_method)bad(400,'Choose a different payment method');amount=order.total-order.discount_total-order.refund_total}
  const id=randomUUID(),created=now();db.prepare('INSERT INTO approval_requests(id,kind,order_id,item_id,quantity,amount,reason,payment_method,requested_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,b.kind,order.id,itemId,qty,amount,reason,paymentMethod,user.id,created,new Date(Date.now()+24*3600000).toISOString());return send(res,201,record(id));
 }
 const match=p.match(/^\/approvals\/([a-f0-9-]+)\/(approve|decline|complete|cancel)$/);
 if(match&&method==='POST'){
  const [_,id,action]=match;const r=record(id);if(!r)bad(404,'Approval request not found');
  if(action==='cancel'){if(r.requested_by!==user.id&&!isApprover)bad(403,'Not permitted');if(r.status!=='pending')bad(409,'Only pending requests can be cancelled');db.prepare("UPDATE approval_requests SET status='cancelled',decided_at=? WHERE id=?").run(now(),id);return send(res,200,record(id))}
  if(action==='approve'||action==='decline'){
   if(!isApprover)bad(403,'Manager or Owner required');if(r.status!=='pending')bad(409,'Request already decided');if(r.expires_at<now())bad(409,'Request has expired');
   db.prepare('UPDATE approval_requests SET status=?,approved_by=?,method=?,decided_at=? WHERE id=? AND status=?').run(action==='approve'?'approved':'declined',user.id,'remote',now(),id,'pending');return send(res,200,record(id));
  }
  if(action==='complete'){
   if(r.status!=='approved')bad(409,'Request is not approved');if(r.expires_at<now())bad(409,'Approval has expired');if(r.kind!=='refund')bad(409,'Payment corrections require a separate workflow');
   const o=db.prepare('SELECT * FROM orders WHERE id=?').get(r.order_id),item=db.prepare('SELECT * FROM order_items WHERE id=?').get(r.item_id);
   if(!o||!item||o.shift_id!==getShift()?.id)bad(409,'Original shift is no longer open');
   db.exec('BEGIN IMMEDIATE');try{
    const used=db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM refunds WHERE item_id=?').get(item.id).n;
    if(r.quantity>item.quantity-used)bad(409,'Item already refunded');
    const net=item.price*item.quantity-Number(item.discount_amount||0),amount=Math.floor(net*(used+r.quantity)/item.quantity)-Math.floor(net*used/item.quantity);
    if(amount!==r.amount||amount>o.total-o.discount_total-o.refund_total)bad(409,'Refund amount has changed. Request a new approval');
    db.prepare('INSERT INTO refunds(id,order_id,item_id,quantity,amount,reason,created_at,requested_by,approved_by,payment_method) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),o.id,item.id,r.quantity,amount,r.reason,now(),r.requester_name,r.approver_name,r.payment_method);
    db.prepare("UPDATE orders SET refund_total=refund_total+?,status=CASE WHEN refund_total+?>=total-discount_total THEN 'refunded' ELSE 'paid' END WHERE id=?").run(amount,amount,o.id);
    db.prepare('UPDATE approval_requests SET status=?,completed_at=?,completed_by=? WHERE id=? AND status=?').run('completed',now(),user.id,id,'approved');db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e}return send(res,200,record(id));
  }
 }
 return null;
}
