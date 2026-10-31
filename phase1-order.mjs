import {randomUUID} from 'node:crypto';

/* V5 Phase 1: server-authoritative modifiers, immutable receipt details and durable KDS outbox.
 * All money is in integer satang. No browser price or option description is trusted.
 */
export function migratePhaseOne(db){
 const columns=db.prepare('PRAGMA table_info(order_items)').all().map(x=>x.name);
 if(!columns.includes('instructions'))db.exec("ALTER TABLE order_items ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
 db.exec(`
CREATE TABLE IF NOT EXISTS modifier_groups(
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 min_select INTEGER NOT NULL DEFAULT 0 CHECK(min_select>=0),
 max_select INTEGER NOT NULL DEFAULT 1 CHECK(max_select>=1 AND max_select<=30),
 active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,
 CHECK(min_select<=max_select));
CREATE TABLE IF NOT EXISTS modifier_options(
 id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES modifier_groups(id),
 name TEXT NOT NULL,price_minor INTEGER NOT NULL CHECK(price_minor>=0),
 active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,
 UNIQUE(group_id,name));
CREATE TABLE IF NOT EXISTS product_modifier_groups(
 product_id TEXT NOT NULL REFERENCES products(id),
 group_id TEXT NOT NULL REFERENCES modifier_groups(id),
 PRIMARY KEY(product_id,group_id));
CREATE TABLE IF NOT EXISTS order_item_modifiers(
 id TEXT PRIMARY KEY,order_item_id TEXT NOT NULL REFERENCES order_items(id),
 option_id TEXT NOT NULL,group_id TEXT NOT NULL,group_name TEXT NOT NULL,
 option_name TEXT NOT NULL,price_minor INTEGER NOT NULL CHECK(price_minor>=0),
 quantity INTEGER NOT NULL CHECK(quantity>=1),
 UNIQUE(order_item_id,option_id));
CREATE TABLE IF NOT EXISTS kitchen_outbox(
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),
 revision INTEGER NOT NULL DEFAULT 1,event_type TEXT NOT NULL,
 payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,
 last_error TEXT,delivered_at TEXT,
 UNIQUE(order_id,revision,event_type));
CREATE INDEX IF NOT EXISTS idx_kitchen_outbox_pending ON kitchen_outbox(status,created_at);
 `);
}
const failure=(status,message)=>{throw Object.assign(new Error(message),{status})};
const nonempty=(s,n)=>{const v=String(s||'').trim();if(!v||v.length>100)failure(400,'Enter a valid '+n+'.');return v};
const integer=(value,low,high,name)=>{if(!Number.isSafeInteger(value)||value<low||value>high)failure(400,'Invalid '+name+'.');return value};
const details=(db,group)=>({...group,options:db.prepare('SELECT id,name,price_minor,active,sort_order FROM modifier_options WHERE group_id=? ORDER BY sort_order,name').all(group.id)});
export function modifierRoutes({db,p,method,b,user,res,send}){
 if(p==='/modifier-groups'&&method==='GET'){
  return send(res,200,db.prepare('SELECT * FROM modifier_groups WHERE active=1 ORDER BY sort_order,name').all().map(g=>details(db,g)));
 }
 if(p.startsWith('/products/')&&p.endsWith('/modifier-groups')&&method==='GET'){
  const productId=p.split('/')[2];
  if(!db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId))failure(404,'Menu item not found.');
  const groups=db.prepare('SELECT g.* FROM modifier_groups g JOIN product_modifier_groups m ON m.group_id=g.id WHERE m.product_id=? AND g.active=1 ORDER BY g.sort_order,g.name').all(productId);
  return send(res,200,groups.map(g=>({...g,options:details(db,g).options.filter(x=>x.active)})));
 }
 if(!['Owner','Manager'].includes(user.role))failure(403,'Manager access is required.');
 if(p==='/modifier-groups'&&method==='POST'){
  const name=nonempty(b.name,'group name'),min=integer(b.minSelect??0,0,30,'minimum selections'),max=integer(b.maxSelect??1,1,30,'maximum selections');
  if(min>max)failure(400,'Minimum cannot exceed maximum selections.');
  const id=randomUUID();
  db.prepare('INSERT INTO modifier_groups(id,name,min_select,max_select,sort_order) VALUES(?,?,?,?,?)').run(id,name,min,max,db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM modifier_groups').get().n);
  return send(res,201,details(db,db.prepare('SELECT * FROM modifier_groups WHERE id=?').get(id)));
 }
 if(/^\/modifier-groups\/[a-f0-9-]{36}$/i.test(p)&&method==='PATCH'){
  const id=p.split('/')[2],g=db.prepare('SELECT * FROM modifier_groups WHERE id=?').get(id);
  if(!g)failure(404,'Modifier group not found.');
  const name=nonempty(b.name??g.name,'group name'),min=integer(b.minSelect??g.min_select,0,30,'minimum'),max=integer(b.maxSelect??g.max_select,1,30,'maximum');
  if(min>max)failure(400,'Minimum cannot exceed maximum.');
  const active=b.active===undefined?g.active:b.active?1:0;
  db.prepare('UPDATE modifier_groups SET name=?,min_select=?,max_select=?,active=? WHERE id=?').run(name,min,max,active,id);
  return send(res,200,details(db,db.prepare('SELECT * FROM modifier_groups WHERE id=?').get(id)));
 }
 if(/^\/modifier-groups\/[a-f0-9-]{36}\/options$/i.test(p)&&method==='POST'){
  const groupId=p.split('/')[2];
  if(!db.prepare('SELECT id FROM modifier_groups WHERE id=? AND active=1').get(groupId))failure(404,'Modifier group not found.');
  const name=nonempty(b.name,'option name'),price=integer(b.priceMinor,0,100000000,'option price');
  const id=randomUUID();
  db.prepare('INSERT INTO modifier_options(id,group_id,name,price_minor,sort_order) VALUES(?,?,?,?,?)').run(id,groupId,name,price,db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM modifier_options WHERE group_id=?').get(groupId).n);
  return send(res,201,db.prepare('SELECT * FROM modifier_options WHERE id=?').get(id));
 }
 if(/^\/modifier-options\/[a-f0-9-]{36}$/i.test(p)&&method==='PATCH'){
  const id=p.split('/')[2],option=db.prepare('SELECT * FROM modifier_options WHERE id=?').get(id);
  if(!option)failure(404,'Modifier option not found.');
  const name=nonempty(b.name??option.name,'option name'),price=integer(b.priceMinor??option.price_minor,0,100000000,'option price');
  const active=b.active===undefined?option.active:b.active?1:0;
  db.prepare('UPDATE modifier_options SET name=?,price_minor=?,active=? WHERE id=?').run(name,price,active,id);
  return send(res,200,db.prepare('SELECT * FROM modifier_options WHERE id=?').get(id));
 }
 if(/^\/products\/[a-f0-9-]{36}\/modifier-groups$/i.test(p)&&method==='POST'){
  const productId=p.split('/')[2];
  if(!db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId))failure(404,'Menu item not found.');
  const ids=b.groupIds;
  if(!Array.isArray(ids)||ids.length>30||new Set(ids).size!==ids.length)failure(400,'Select distinct modifier groups.');
  for(const id of ids)if(!db.prepare('SELECT id FROM modifier_groups WHERE id=? AND active=1').get(id))failure(400,'A modifier group is unavailable.');
  db.exec('BEGIN IMMEDIATE');
  try{db.prepare('DELETE FROM product_modifier_groups WHERE product_id=?').run(productId);
   const insert=db.prepare('INSERT INTO product_modifier_groups VALUES(?,?)');
   for(const id of ids)insert.run(productId,id);
   db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
  return send(res,200,{ok:true,groupIds:ids});
 }
 return null;
}
export function priceOrderLine(db,line,product){
 const qty=integer(line.quantity,1,100,'item quantity');
 const groups=db.prepare('SELECT g.* FROM modifier_groups g JOIN product_modifier_groups pg ON pg.group_id=g.id WHERE pg.product_id=? AND g.active=1 ORDER BY g.sort_order,g.id').all(product.id);
 const chosen=line.modifiers??[];
 if(!Array.isArray(chosen)||chosen.length>50)failure(400,'Invalid item modifiers.');
 const seen=new Set(),selections=[],quantities=new Map();
 let adjustment=0;
 for(const choice of chosen){
  const id=String(choice.optionId||'');
  if(seen.has(id))failure(400,'A modifier option was selected twice.');
  seen.add(id);
  const opt=db.prepare('SELECT o.*,g.name AS group_name,g.active AS group_active FROM modifier_options o JOIN modifier_groups g ON g.id=o.group_id WHERE o.id=?').get(id);
  if(!opt||!opt.active||!opt.group_active||!groups.some(g=>g.id===opt.group_id))failure(400,'An option is not available for this menu item.');
  const quantity=integer(choice.quantity??1,1,30,'option quantity');
  quantities.set(opt.group_id,(quantities.get(opt.group_id)||0)+quantity);
  const delta=opt.price_minor*quantity;
  if(!Number.isSafeInteger(delta))failure(400,'Option amount is too large.');
  adjustment+=delta;
  selections.push({id:opt.id,groupId:opt.group_id,groupName:opt.group_name,name:opt.name,priceMinor:opt.price_minor,quantity});
 }
 for(const group of groups){const number=quantities.get(group.id)||0;
  if(number<group.min_select||number>group.max_select)failure(400,'Select '+group.min_select+'–'+group.max_select+' options from '+group.name+'.');
 }
 const notes=String(line.instructions||'').trim();
 if(notes.length>500)failure(400,'Preparation instructions are too long.');
 const price=product.price+adjustment;
 if(!Number.isSafeInteger(price)||price<0)failure(400,'Item price is invalid.');
 return {product,qty,price,basePrice:product.price,modifiers:selections,instructions:notes};
}
export function saveOrderLineModifiers(db,lineId,line){
 const ins=db.prepare('INSERT INTO order_item_modifiers(id,order_item_id,option_id,group_id,group_name,option_name,price_minor,quantity) VALUES(?,?,?,?,?,?,?,?)');
 for(const m of line.modifiers)ins.run(randomUUID(),lineId,m.id,m.groupId,m.groupName,m.name,m.priceMinor,m.quantity);
}
export function enrichOrder(db,order){
 if(!order)return null;
 for(const item of order.items){
  item.modifiers=db.prepare('SELECT option_id AS optionId,group_name AS groupName,option_name AS name,price_minor AS priceMinor,quantity FROM order_item_modifiers WHERE order_item_id=? ORDER BY group_name,option_name').all(item.id);
 }
 return order;
}
export function enqueueKitchenOrder(db,order){
 const t=new Date().toISOString();
 const items=order.items.map((item,i)=>({
  lineId:item.id,name:item.name,sku:item.product_id||'',
  quantity:item.quantity,unitPriceMinor:item.price,modifiers:item.modifiers||[],
  instructions:item.instructions||'',lineNumber:i+1
 }));
 const packing=db.prepare('SELECT snapshot FROM order_packing_snapshots WHERE order_id=?').get(order.id);if(packing){const saved=JSON.parse(packing.snapshot);for(const item of items){const line=saved.lines.find(l=>l.lineId===item.lineId);if(line)item.packingComponents=line.components;}}
 const snapshot={schemaVersion:1,orderId:order.id,revision:1,sourceReceiptId:String(order.receipt_number),placedAt:order.created_at,kitchenReleaseAt:order.created_at,channel:order.mode,partnerReference:order.partner_reference||'',items,
  // Routing and production components must be resolved by the KDS integration adapter, not fabricated here.
  routingStatus:'awaiting_configuration'};
 db.prepare('INSERT INTO kitchen_outbox(id,order_id,revision,event_type,payload,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),order.id,1,'order.created',JSON.stringify(snapshot),t);
}
