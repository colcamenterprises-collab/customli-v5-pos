import {randomUUID} from 'node:crypto';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const moneyMinor=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
const validName=name=>typeof name==='string'&&name.trim().length>=2&&name.trim().length<=70;
export const baseChannel='in-store';

export function migrateSalesChannels(db){
 db.exec(`CREATE TABLE IF NOT EXISTS sales_channels(
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 kind TEXT NOT NULL CHECK(kind IN ('direct','partner')),
 active INTEGER NOT NULL DEFAULT 1,
 is_default INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS channel_prices(
 channel_id TEXT NOT NULL REFERENCES sales_channels(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 price_minor INTEGER NOT NULL CHECK(price_minor>=0 AND price_minor<=100000000),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(channel_id,product_id));
 CREATE TABLE IF NOT EXISTS channel_price_audit(
 id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,product_id TEXT,
 actor_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,
 created_at TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_default ON sales_channels(is_default) WHERE is_default=1;`);
 const now=new Date().toISOString();
 db.prepare(`INSERT OR IGNORE INTO sales_channels(id,name,kind,active,is_default,created_at,updated_at) VALUES(?,?,'direct',1,1,?,?)`).run(baseChannel,'In-store',now,now);
 const cols=t=>db.prepare(`PRAGMA table_info(${t})`).all().map(x=>x.name);
 if(!cols('orders').includes('channel_id'))db.exec("ALTER TABLE orders ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'in-store'");
 if(!cols('orders').includes('partner_reference'))db.exec("ALTER TABLE orders ADD COLUMN partner_reference TEXT");
 if(!cols('orders').includes('partner_ticket_total'))db.exec("ALTER TABLE orders ADD COLUMN partner_ticket_total INTEGER");
 if(!cols('orders').includes('partner_item_discount'))db.exec('ALTER TABLE orders ADD COLUMN partner_item_discount INTEGER NOT NULL DEFAULT 0');
 if(!cols('orders').includes('partner_order_discount'))db.exec('ALTER TABLE orders ADD COLUMN partner_order_discount INTEGER NOT NULL DEFAULT 0');
 if(!cols('order_items').includes('partner_discount'))db.exec('ALTER TABLE order_items ADD COLUMN partner_discount INTEGER NOT NULL DEFAULT 0');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_reference ON orders(channel_id,partner_reference) WHERE partner_reference IS NOT NULL");
 // Backfill explicit prices only for existing rows in the default channel. No implicit fallback for partners.
 db.prepare('INSERT OR IGNORE INTO channel_prices(channel_id,product_id,price_minor,updated_at) SELECT ?,id,price,? FROM products').run(baseChannel,now);
}
export const channelFor=(db,id)=>db.prepare('SELECT * FROM sales_channels WHERE id=? AND active=1').get(id||baseChannel);
export function priceFor(db,productId,channelId){
 if(channelId===baseChannel)return db.prepare('SELECT price FROM products WHERE id=? AND active=1').get(productId)?.price;
 return db.prepare('SELECT cp.price_minor FROM channel_prices cp JOIN sales_channels c ON c.id=cp.channel_id AND c.active=1 WHERE cp.channel_id=? AND cp.product_id=?').get(channelId,productId)?.price_minor;
}
export function seedProductPrices(db,productId,price){
 const now=new Date().toISOString();
 db.prepare('INSERT OR REPLACE INTO channel_prices(channel_id,product_id,price_minor,updated_at) VALUES(?,?,?,?)').run(baseChannel,productId,price,now);
 // New products start unpriced on partner channels, so an owner must explicitly set their partner prices.
}
const snapshot=db=>({channels:db.prepare('SELECT id,name,kind,active,is_default FROM sales_channels ORDER BY is_default DESC,name').all(),prices:db.prepare('SELECT channel_id,product_id,price_minor FROM channel_prices ORDER BY channel_id,product_id').all()});
const audit=(db,channelId,productId,user,action,detail)=>db.prepare('INSERT INTO channel_price_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),channelId,productId,user.id,action,JSON.stringify(detail),new Date().toISOString());
export function salesChannelRoute({db,p,method,b,user,res,send}){
 if(p==='/sales-channels'&&method==='GET')return send(res,200,db.prepare('SELECT id,name,kind,active,is_default FROM sales_channels WHERE active=1 OR ?=1 ORDER BY is_default DESC,name').all(user.role==='Owner'?1:0));
 if(p==='/sales-channels/prices'&&method==='GET')return send(res,200,snapshot(db));
 if(p==='/sales-channels'&&method==='POST'){
  if(user.role!=='Owner')fail(403,'Only owners can manage sales channels');
  const name=String(b.name||'').trim(),kind=String(b.kind||'partner');
  if(!validName(name)||!['direct','partner'].includes(kind))fail(400,'Enter a valid sales channel name and type');
  if(db.prepare('SELECT id FROM sales_channels WHERE name=? COLLATE NOCASE').get(name))fail(409,'A channel with this name already exists');
  const now=new Date().toISOString(),id=randomUUID();
  db.prepare('INSERT INTO sales_channels(id,name,kind,active,is_default,created_at,updated_at) VALUES(?,?,?,1,0,?,?)').run(id,name,kind,now,now);
  audit(db,id,null,user,'create',{name,kind});
  return send(res,201,{id,name,kind,active:1,is_default:0});
 }
 const matched=p.match(/^\/sales-channels\/([0-9a-f-]{36}|in-store)$/i);
 if(matched&&method==='PATCH'){
  if(user.role!=='Owner')fail(403,'Only owners can manage sales channels');
  const channel=db.prepare('SELECT * FROM sales_channels WHERE id=?').get(matched[1]);if(!channel)fail(404,'Sales channel not found');
  const name=String(b.name??channel.name).trim(),active=b.active===undefined?channel.active:(b.active?1:0);
  if(!validName(name))fail(400,'Enter a valid channel name');
  if(channel.is_default&&(!active||name!==channel.name))fail(400,'The in-store channel cannot be renamed or disabled');
  if(db.prepare('SELECT id FROM sales_channels WHERE name=? COLLATE NOCASE AND id<>?').get(name,channel.id))fail(409,'This channel name already exists');
  db.prepare('UPDATE sales_channels SET name=?,active=?,updated_at=? WHERE id=?').run(name,active,new Date().toISOString(),channel.id);
  audit(db,channel.id,null,user,'update',{from:{name:channel.name,active:channel.active},to:{name,active}});
  return send(res,200,{id:channel.id,name,kind:channel.kind,active,is_default:channel.is_default});
 }
 if(p==='/sales-channels/prices'&&method==='POST'){
  if(user.role!=='Owner')fail(403,'Only owners can manage pricing');
  const entries=b.entries;
  if(!Array.isArray(entries)||entries.length<1||entries.length>1000)fail(400,'Choose menu items and enter their prices');
  const found=new Set();
  for(const row of entries){
   if(!row||typeof row.productId!=='string'||typeof row.channelId!=='string'||!moneyMinor(row.priceMinor)||found.has(row.channelId+'|'+row.productId))fail(400,'Prices must be nonnegative and each product can only appear once per channel');
   found.add(row.channelId+'|'+row.productId);
   if(!db.prepare('SELECT id FROM sales_channels WHERE id=? AND active=1').get(row.channelId))fail(400,'Sales channel is unavailable');
   if(row.channelId===baseChannel)fail(400,'Edit in-store prices in the menu');
   if(!db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(row.productId))fail(400,'Menu item is unavailable');
  }
  db.exec('BEGIN IMMEDIATE');try{
   const now=new Date().toISOString();
   const up=db.prepare('INSERT INTO channel_prices(channel_id,product_id,price_minor,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel_id,product_id) DO UPDATE SET price_minor=excluded.price_minor,updated_at=excluded.updated_at');
   for(const row of entries){const old=db.prepare('SELECT price_minor FROM channel_prices WHERE channel_id=? AND product_id=?').get(row.channelId,row.productId);up.run(row.channelId,row.productId,row.priceMinor,now);if(old?.price_minor!==row.priceMinor)audit(db,row.channelId,row.productId,user,'price',{previous:old?.price_minor??null,current:row.priceMinor});}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  return send(res,200,{updated:entries.length});
 }
 return null;
}
