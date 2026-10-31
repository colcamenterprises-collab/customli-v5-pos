import {randomUUID} from 'node:crypto';
import {channelFor,priceFor,baseChannel} from './sales-channels.mjs';
import {priceOrderLine} from './phase1-order.mjs';
import {fail,hash,location,now,simplePacking,templates,createDocuments,audit} from './print-model.mjs';
import {renderDocument,encodeDocument} from './print-render.mjs';
import {assetsFor} from './print-service.mjs';
// A payment request is a quote, never an order/payment row. Settlement remains an explicit POS action.
export async function paymentRequest({db,b,user,res,send}){
 const loc=location(db),channel=channelFor(db,b.channelId||baseChannel);if(!channel||channel.kind==='partner')fail(400,'Payment requests are available for direct sales.');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail(400,'Add items before printing a bill.');
 const items=b.items.map((input,i)=>{const product=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(input.productId);if(!product)fail(400,'A menu item is unavailable.');const priced=priceOrderLine(db,input,product),base=priceFor(db,product.id,channel.id);if(!Number.isSafeInteger(base))fail(400,'Configure this sales channel price.');return{id:'quote-'+i,product_id:product.id,name:product.name,price:priced.price-product.price+base,quantity:priced.qty,instructions:priced.instructions,modifiers:priced.modifiers};});
 const subtotal=items.reduce((a,x)=>a+x.price*x.quantity,0),discount=b.discountId?db.prepare('SELECT * FROM discount_catalog WHERE id=? AND active=1').get(b.discountId):null;
 if(b.discountId&&!discount)fail(400,'Select an available discount.');if(discount?.access_mode!=='cashier'&&user.role==='Cashier'&&discount)fail(403,'A manager must prepare this discounted bill.');
 const discountTotal=discount?(discount.kind==='percent'?Math.round(subtotal*discount.value/10000):Math.min(subtotal,discount.value)):0;
 const order={id:'quote-'+randomUUID(),receipt_number:'BILL',status:'unpaid',created_at:now(),mode:b.mode||'Dine-in',channel_id:channel.id,subtotal,total:subtotal,tax:0,discount_total:discountTotal,refund_total:0,items};
 const t=templates(db,loc).find(t=>t.id===b.templateId&&t.purpose==='payment')||templates(db,loc).find(t=>t.purpose==='payment'),document=createDocuments(order,t.config,simplePacking(order),{templateId:t.id,templateVersion:t.version})[0],assets=assetsFor(db,document,loc),rendered=await renderDocument(document,assets);
 if(b.printerId){const device=db.prepare('SELECT * FROM printer_devices WHERE id=? AND location_id=? AND revoked=0').get(b.printerId,loc);if(!device)fail(400,'Choose a printer.');await encodeDocument(document,JSON.parse(device.profile),assets);const key=String(b.idempotencyKey||'');if(!key||key.length>100)fail(400,'Provide a unique bill request.');const existing=db.prepare('SELECT id FROM print_batches WHERE event_key=?').get(loc+':bill:'+key);if(!existing){const batchId=randomUUID(),jobId=randomUUID();document.batchId=batchId;const snapshot=JSON.stringify(document);db.prepare('INSERT INTO print_batches VALUES(?,?,?,?,?,?)').run(batchId,loc,order.id,1,loc+':bill:'+key,now());db.prepare('INSERT INTO print_jobs(id,location_id,batch_id,order_id,revision,printer_id,purpose,snapshot,content_hash,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(jobId,loc,batchId,order.id,1,device.id,'payment',snapshot,hash(snapshot),loc+':bill:'+key,now());audit(db,loc,user.id,'payment_request.queued',{batchId});}}
 return send(res,200,{image:'data:image/png;base64,'+rendered.png.toString('base64'),amountDueMinor:subtotal-discountTotal,status:'unpaid',expiresAt:new Date(Date.now()+300000).toISOString(),queued:Boolean(b.printerId)});
}
