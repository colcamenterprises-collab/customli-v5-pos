// Customer snapshots contain no staff, cash drawer, cost or account fields.
export function customerDisplay({db,bad,priceOrderLine,channelFor,priceFor,getOrder}) {
 db.exec(`CREATE TABLE IF NOT EXISTS customer_displays(pos_device_id TEXT PRIMARY KEY,location_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`);
 const blank=()=>({items:[],subtotal:0,discount:0,total:0,state:'waiting',branding:{name:'Customli',logo:''}});
 return ({user,p,method,b,url,res,send})=>{
  if(p!=='/display')return false;
  const d=user.device;if(!d||!['POS','CDS'].includes(d.mode))bad(403,'Use a registered POS or customer display');
  if(method==='GET'){
   if(d.mode!=='CDS')bad(403,'Customer display access is required');
   const requested=url.searchParams.get('posDeviceId');if(requested&&requested!==d.posDeviceId)bad(403,'This POS is not assigned to your display');
   const row=db.prepare('SELECT * FROM customer_displays WHERE pos_device_id=? AND location_id=?').get(d.posDeviceId||'',d.locationId);
   const snapshot=row?JSON.parse(row.payload):blank();
   send(res,200,{...snapshot,updatedAt:row?.updated_at||null,stale:!!row&&Date.now()-Date.parse(row.updated_at)>90000});return true;
  }
  if(method!=='POST'||d.mode!=='POS')bad(403,'Only a registered POS can update its customer display');
  if(!Number.isSafeInteger(b.revision)||b.revision<1)bad(400,'A display revision is required');
  let snapshot=blank();
  if(b.orderId){
   const o=getOrder(String(b.orderId));
   // Bind the completion snapshot to a receipt previously submitted by this device.
   const link=db.prepare('SELECT 1 FROM device_order_links WHERE order_id=? AND device_id=?').get(String(b.orderId),d.id);
   if(!o||!link)bad(404,'Receipt is not available on this device');
   snapshot={...snapshot,state:'recorded',items:o.items.map(x=>({name:x.name,quantity:x.quantity,unitPrice:x.price})),subtotal:o.subtotal,discount:o.discount_total,total:o.total-o.discount_total,receiptNumber:o.receipt_number,paymentMethod:o.payment_method};
  }else if(Array.isArray(b.items)&&b.items.length){
   if(b.items.length>100)bad(400,'Too many display items');
   const channel=channelFor(db,b.channelId||'in-store');if(!channel)bad(400,'Choose an active sales channel');
   const items=b.items.map(line=>{const product=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(line.productId));if(!product)bad(400,'An item is unavailable');const priced=priceOrderLine(db,line,product);const base=priceFor(db,product.id,channel.id);if(!Number.isSafeInteger(base))bad(400,'Sales channel price is unavailable');return {name:product.name,quantity:Number(line.quantity),unitPrice:base+priced.price-product.price};});
   const subtotal=items.reduce((sum,x)=>sum+x.unitPrice*x.quantity,0);
   let discount=0;
   if(b.discountId){const rule=db.prepare('SELECT * FROM discount_catalog WHERE id=? AND active=1').get(String(b.discountId));if(!rule)bad(400,'Discount is unavailable');if(user.role==='Cashier'&&rule.access_mode!=='cashier')bad(403,'This discount requires approval');discount=rule.kind==='percent'?Math.round(subtotal*rule.value/10000):Math.min(subtotal,rule.value);}
   if(channel.kind==='partner'){discount=Number(b.partnerDiscountMinor||0);if(!Number.isSafeInteger(discount)||discount<0||discount>subtotal)bad(400,'Check the delivery discount');}
   snapshot={...snapshot,items,subtotal,discount,total:subtotal-discount,state:'order'};
  }
  db.prepare(`INSERT INTO customer_displays(pos_device_id,location_id,revision,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(pos_device_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at WHERE excluded.revision>customer_displays.revision`).run(d.id,d.locationId,b.revision,JSON.stringify(snapshot),new Date().toISOString());
  send(res,200,{ok:true});return true;
 };
}
