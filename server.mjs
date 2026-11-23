import { accountStaffAccess, permitsStaffRequest } from './staff-app-access.mjs';
import {customerDisplay} from './customer-display.mjs';
import {publishKitchenPrintEvents} from './print-kds-events.mjs';
import {platformIdentity,platformPassword} from './platform-auth-client.mjs';
import {migrateExpenses,handleExpenses} from './expenses.mjs';
import {migrateOnboarding,handleOnboarding} from './onboarding.mjs';
import {migratePrint,snapshotPacking,enqueuePrint,revisePacking} from './print-model.mjs';
import {printRoute,agentRoute} from './print-service.mjs';
import { migrateTenantScoping } from './migrate-tenant-scoping.mjs';
import http from 'node:http';import{DatabaseSync}from'node:sqlite';import{randomUUID,scryptSync,timingSafeEqual,randomBytes,createHash}from'node:crypto';import{mkdirSync,readFileSync,existsSync,writeFileSync}from'node:fs';import path from'node:path';import{migrateSaleCosts,snapshotSaleCost}from'./sales-costs.mjs';import{migrateStockControl,handleStockControl}from'./stock-control.mjs';import{migrateShiftReconciliation,handleShiftReconciliation}from'./shift-reconciliation.mjs';import{migrateMenuAdmin,handleMenuAdmin,handleProductConfiguration,migrateProductPriceOptions}from'./menu-admin.mjs';import{migrateReporting,handleReporting}from'./reporting.mjs';import{migratePhaseOne,modifierRoutes,priceOrderLine,saveOrderLineModifiers,enrichOrder,enqueueKitchenOrder}from'./phase1-order.mjs';import{migrateKdsConfig,kdsConfigRoute,kdsOutboxRoute}from'./kds-config.mjs';import{handleShiftAnalytics}from'./shift-analytics.mjs';import{migrateFoodModel,handleFoodModel}from'./food-model.mjs';import{migratePurchasing,handlePurchasing}from'./purchasing.mjs';import{migrateRecipeCosting,handleRecipeCosting}from'./recipe-costing.mjs';import{installApprovals,approvalRoutes}from'./approvals.mjs';import{installDiscountCatalog,catalogRoute}from'./discount-catalog.mjs';import{migrateSalesChannels,salesChannelRoute,channelFor,priceFor,seedProductPrices,baseChannel}from'./sales-channels.mjs';
const dir=process.env.V5_DATA_DIR||'/var/lib/customli-v5';mkdirSync(dir,{recursive:true});const db=new DatabaseSync(path.join(dir,'pos.sqlite'));db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),image TEXT DEFAULT '',active INTEGER NOT NULL DEFAULT 1);CREATE TABLE IF NOT EXISTS shifts(id TEXT PRIMARY KEY,opened_at TEXT NOT NULL,closed_at TEXT,opening_cash INTEGER NOT NULL,closing_cash INTEGER,expected_cash INTEGER,variance INTEGER);CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,receipt_number INTEGER UNIQUE NOT NULL,shift_id TEXT NOT NULL REFERENCES shifts(id),created_at TEXT NOT NULL,mode TEXT NOT NULL,table_name TEXT,subtotal INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL,payment_method TEXT NOT NULL,received INTEGER,change_due INTEGER NOT NULL,refund_total INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'paid',idempotency_key TEXT UNIQUE);CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT,name TEXT NOT NULL,price INTEGER NOT NULL,quantity INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS sequence(name TEXT PRIMARY KEY,value INTEGER NOT NULL);INSERT OR IGNORE INTO sequence(name,value) VALUES('receipt',0);`);
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('Cashier','Manager','Owner')),salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER DEFAULT 1);CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1);CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),item_id TEXT NOT NULL REFERENCES order_items(id),quantity INTEGER NOT NULL,amount INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,requested_by TEXT NOT NULL,approved_by TEXT NOT NULL);CREATE TABLE IF NOT EXISTS payment_corrections(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),previous_method TEXT NOT NULL,new_method TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,approved_by TEXT NOT NULL);`);
for(const c of db.prepare('SELECT DISTINCT category FROM products').all()){db.prepare('INSERT OR IGNORE INTO categories(id,name,sort_order) VALUES(?,?,?)').run(randomUUID(),c.category,0)}
db.exec(`CREATE TABLE IF NOT EXISTS manager_pins(user_id TEXT PRIMARY KEY REFERENCES users(id),salt TEXT NOT NULL,pin_hash TEXT NOT NULL,failed_attempts INTEGER NOT NULL DEFAULT 0,locked_until TEXT);CREATE TABLE IF NOT EXISTS manager_approvals(id TEXT PRIMARY KEY,manager_id TEXT NOT NULL,requester_id TEXT NOT NULL,action TEXT NOT NULL,order_id TEXT NOT NULL,created_at TEXT NOT NULL);`);
const cryptoHash=t=>createHash('sha256').update(t).digest('hex');const passHash=(p,s)=>scryptSync(p,s,64).toString('hex');const verify=(p,u)=>{const a=Buffer.from(passHash(p,u.salt),'hex'),b=Buffer.from(u.password_hash,'hex');return a.length===b.length&&timingSafeEqual(a,b)};
const bootstrap=process.env.V5_BOOTSTRAP_PASSWORD;
if(bootstrap&&!db.prepare("SELECT id FROM users WHERE role='Manager' LIMIT 1").get()){const salt=randomBytes(16).toString('hex');db.prepare('INSERT INTO users(id,username,role,salt,password_hash) VALUES(?,?,?,?,?)').run(randomUUID(),'manager','Manager',salt,passHash(bootstrap,salt))}
const SSO_COOKIE=process.env.V5_API_PREFIX==='/v5-test/api'?'__Host-CustomliV5Test':'__Host-CustomliV5';
const cookieSession=req=>{
 const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(SSO_COOKIE+'='));
 return raw?raw.slice(SSO_COOKIE.length+1):'';
};
const bearerSession=req=>{const v=req.headers.authorization||'';return /^Bearer [A-Za-z0-9_-]{40,100}$/.test(v)?v.slice(7):''};
const sessionFor=req=>{
 const token=bearerSession(req);
 if(token){
  const match=db.prepare('SELECT users.id,users.username,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND users.active=1').get(cryptoHash(token),new Date().toISOString());
  if(match)return match;
 }
 const cookie=cookieSession(req);
 return cookie?db.prepare('SELECT users.id,users.username,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND users.active=1').get(cryptoHash(cookie),new Date().toISOString())||null:null;
};
const sessionCookie=(value,maxAge)=>SSO_COOKIE+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
const cookieOriginAllowed=req=>{
 const origin=req.headers.origin;
 return origin==='https://customli.io'||origin==='https://www.customli.io';
};
const auth=async req=>{
 if(!process.env.PLATFORM_AUTH_INTROSPECT_URL)throw Object.assign(new Error('Dashboard identity service is required'),{status:503});
 const token=bearerSession(req),identity=await platformIdentity(token);if(!identity)return null;
 const requiredTenant=process.env.PLATFORM_TENANT_ID||'';
 if(!requiredTenant)return null;
 const member=identity.memberships.find(m=>m.tenantId===requiredTenant);
 if(identity.device&&(!process.env.PLATFORM_LOCATION_ID||identity.device.locationId!==process.env.PLATFORM_LOCATION_ID||identity.device.tenantId!==requiredTenant))return null;
 if(!member||!['Owner','Manager','Staff','Cashier'].includes(member.role))return null;
 const permissions=accountStaffAccess(identity,requiredTenant,process.env.PLATFORM_LOCATION_ID,process.env.V5_REQUIRE_STAFF_ACCESS==='true');
 if(permissions===null)bad(403,'Staff access is not assigned to this location');
 const requestedLocation=req.headers['x-customli-location'];
 if(requestedLocation!==undefined&&(
  typeof requestedLocation!=='string'||!requestedLocation||
  requestedLocation!==process.env.PLATFORM_LOCATION_ID||
  (identity.device
   ? identity.device.locationId!==requestedLocation
   : !Array.isArray(identity.locations)||!identity.locations.some(location=>
     location.id===requestedLocation&&location.tenantId===requiredTenant))
 ))return null;
 const role=member.role==='Staff'?'Cashier':member.role;
 let user=db.prepare('SELECT id,username,role FROM users WHERE id=? AND active=1').get(identity.id);
 if(!user){
  let username=String(identity.displayName||identity.email||'user').trim().slice(0,32)||'user';
  if(db.prepare('SELECT id FROM users WHERE username=?').get(username))username=(identity.email||'user').slice(0,22)+'-'+identity.id.slice(0,8);
  const salt=randomBytes(16).toString('hex'),randomPassword=randomBytes(48).toString('base64url');
  db.prepare('INSERT INTO users(id,username,role,salt,password_hash,active) VALUES(?,?,?,?,?,1)').run(identity.id,username,role,salt,passHash(randomPassword,salt));
  user={id:identity.id,username,role};
 }else if(user.role!==role){
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role,user.id);user={...user,role};
 }
 const installation=req.headers['x-customli-installation'];
 const mode=req.headers['x-customli-mode'];
 let operationalDevice=identity.device||null;
 if(!operationalDevice&&installation!==undefined){
  const requestedLocation=req.headers['x-customli-location'];
  if(typeof installation!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(installation)||
     !['POS','CDS'].includes(mode)||requestedLocation!==process.env.PLATFORM_LOCATION_ID||
     !identity.locations?.some(location=>location.id===requestedLocation&&location.tenantId===requiredTenant))return null;
  if(permissions&&!permissions.has('applications.'+mode.toLowerCase()))bad(403,'This app is not assigned to your account');
  operationalDevice={id:'account:'+identity.id+':'+installation,tenantId:requiredTenant,
   locationId:requestedLocation,installationId:installation,mode,posDeviceId:null};
  if(mode==='CDS'){
   const posId=req.headers['x-customli-pos-device'];
   if(typeof posId==='string'&&posId){
    const terminal=db.prepare(`SELECT id FROM operational_terminals
     WHERE id=? AND tenant_id=? AND location_id=? AND seen_at>?`).get(
      posId,requiredTenant,requestedLocation,new Date(Date.now()-86400000).toISOString());
    if(!terminal)return null;
    operationalDevice.posDeviceId=terminal.id;
   }
  }else{
   db.prepare(`INSERT INTO operational_terminals(id,tenant_id,location_id,seen_at)
    VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at`).run(
     operationalDevice.id,requiredTenant,requestedLocation,new Date().toISOString());
  }
 }
 return {...user,tenantId:requiredTenant,device:operationalDevice,permissions};
};const manager=u=>{if(!['Manager','Owner'].includes(u.role))bad(403,'Manager approval required')};const authorize=(b,user,action,orderId)=>{if(!b.approval||!b.approval.managerId||!b.approval.pin)bad(403,'Manager PIN approval required');const m=db.prepare("SELECT users.id,users.role,manager_pins.* FROM users JOIN manager_pins ON users.id=manager_pins.user_id WHERE users.id=? AND users.active=1 AND users.role IN ('Manager','Owner')").get(String(b.approval.managerId));if(!m)bad(403,'Manager PIN is not configured');if(m.locked_until&&new Date(m.locked_until)>new Date())bad(429,'Manager PIN temporarily locked');const valid=verify(String(b.approval.pin),{salt:m.salt,password_hash:m.pin_hash});if(!valid){const attempts=m.failed_attempts+1;db.prepare('UPDATE manager_pins SET failed_attempts=?,locked_until=? WHERE user_id=?').run(attempts,attempts>=5?new Date(Date.now()+15*60000).toISOString():null,m.id);bad(403,attempts>=5?'Manager PIN temporarily locked':'Incorrect manager PIN')}db.prepare('UPDATE manager_pins SET failed_attempts=0,locked_until=NULL WHERE user_id=?').run(m.id);return m.id};
if(process.env.V5_DEMO_SEED==='1'&&!db.prepare('SELECT id FROM products LIMIT 1').get()){const rows=[['Salmori Sushi',1000],['Nori Glaze Salmon Sushi',1100],['Sweet Shrimp Sushi',1200],['Umami Gyuniku Sushi',1350],['Tamago Ikura Sushi',1150],['Maguro Wasabi Sushi',1200],['Nori Pop Sushi',1100],['Shrimp Wrap Sushi',1250]];for(const [name,price]of rows)db.prepare('INSERT INTO products(id,name,category,price) VALUES(?,?,?,?)').run(randomUUID(),name,'Nigiri Sushi',price)}
for(const c of db.prepare('SELECT DISTINCT category FROM products').all()){db.prepare('INSERT OR IGNORE INTO categories(id,name,sort_order) VALUES(?,?,0)').run(randomUUID(),c.category)}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};const bad=(s,m)=>{throw Object.assign(new Error(m),{status:s})};const body=async req=>{let s='';for await(const c of req){s+=c;if(s.length>2e6)bad(413,'Request too large')}try{return JSON.parse(s||'{}')}catch{bad(400,'Invalid request')}};db.exec(`CREATE TABLE IF NOT EXISTS shift_cash_movements(id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES shifts(id),direction TEXT NOT NULL CHECK(direction IN ('in','out')),amount INTEGER NOT NULL CHECK(amount>0),description TEXT NOT NULL,place TEXT NOT NULL,recorded_by TEXT NOT NULL,created_at TEXT NOT NULL);`);const getShift=()=>db.prepare('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1').get();const getOrder=id=>{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(id);return o?enrichOrder(db,{...o,items:db.prepare('SELECT id,product_id,name,price,quantity,category,instructions,discount_amount,partner_discount,(SELECT COALESCE(SUM(quantity),0) FROM refunds WHERE item_id=order_items.id) AS refunded_quantity FROM order_items WHERE order_id=?').all(id)}):null};
migrateReporting(db);migrateFoodModel(db);migratePurchasing(db);migrateRecipeCosting(db);migrateMenuAdmin(db);db.exec('CREATE TABLE IF NOT EXISTS menu_availability_audit(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,actor_id TEXT NOT NULL,previous_status INTEGER NOT NULL,new_status INTEGER NOT NULL,created_at TEXT NOT NULL)');migratePhaseOne(db);migrateProductPriceOptions(db);migrateSaleCosts(db);migrateStockControl(db);migrateShiftReconciliation(db);if(process.env.V5_KDS_ROUTING_ENABLED==='1')migrateKdsConfig(db);installApprovals(db);installDiscountCatalog(db);migrateSalesChannels(db);migratePrint(db);migrateOnboarding(db);migrateExpenses(db);
migrateTenantScoping(db);
db.exec(`CREATE TABLE IF NOT EXISTS shift_movement_receipts(movement_id TEXT PRIMARY KEY REFERENCES shift_cash_movements(id),image_jpeg BLOB NOT NULL,uploaded_by TEXT NOT NULL,created_at TEXT NOT NULL)`);
const apiPrefix=process.env.V5_API_PREFIX||'/v5/api';
db.exec('CREATE TABLE IF NOT EXISTS order_request_resolutions(idempotency_key TEXT PRIMARY KEY,device_id TEXT NOT NULL,reason TEXT NOT NULL,approved_by TEXT NOT NULL,resolved_at TEXT NOT NULL,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS order_request_hashes(idempotency_key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS device_order_links(order_id TEXT PRIMARY KEY REFERENCES orders(id),device_id TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS operational_terminals(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,location_id TEXT NOT NULL,seen_at TEXT NOT NULL)');
const displayRoute=customerDisplay({db,bad,priceOrderLine,channelFor,priceFor,getOrder});
const handler=async(req,res)=>{if(!req.url.startsWith(apiPrefix+'/'))return send(res,404,{message:'Not found'});try{const url=new URL(req.url,'http://localhost'),p=url.pathname.slice(apiPrefix.length),method=req.method;let b;if(['POST','PATCH','PUT'].includes(method))b=await body(req);if(p==='/login'&&method==='POST')bad(410,'Sign in through the Dashboard identity service');if(p.startsWith('/print-agent/'))return await agentRoute({db,p,method,b,req,res,send});const user=await auth(req);if(!user)bad(401,'Sign in to continue');if(user.permissions&&!permitsStaffRequest({permissions:user.permissions,mode:user.device?.mode,path:p,method,query:url.searchParams,body:b}))bad(403,'Your staff access does not allow this action');if(user.device&&user.device.mode!=='POS'&&p!=='/display'&&p!=='/display/terminals'&&!(user.permissions&&p==='/me'))bad(403,'This action is unavailable in the assigned device mode');if(p==='/display/terminals'&&method==='GET'){
 if(user.device?.mode!=='CDS')bad(403,'Customer display access is required');
 return send(res,200,db.prepare(`SELECT id,seen_at AS seenAt FROM operational_terminals
  WHERE tenant_id=? AND location_id=? AND seen_at>? ORDER BY seen_at DESC LIMIT 50`).all(
   user.device.tenantId,user.device.locationId,new Date(Date.now()-86400000).toISOString()));
 }if(displayRoute({user,p,method,b,url,res,send}))return;if(!['GET','HEAD','OPTIONS'].includes(method)&&!bearerSession(req)&&!cookieOriginAllowed(req))bad(403,'Request origin not permitted');if(p==='/me'){const legacy=bearerSession(req);if(legacy&&!cookieSession(req))res.setHeader('Set-Cookie',sessionCookie(legacy,43200));const {permissions,...profile}=user;return send(res,200,permissions?{...profile,permissions:[...permissions]}:profile)}if(p.startsWith('/onboarding'))return handleOnboarding({db,p,method,b,user,res,send});if(p.startsWith('/expenses'))return handleExpenses({db,p,url,method,b,user,res,send});if(p.startsWith('/print/'))return await printRoute({db,p,method,b,user,res,send,getOrder});if(p.startsWith('/categories')||p.startsWith('/products')){if(handleProductConfiguration({db,p,method,b,user,res}))return;if(handleMenuAdmin({db,p,method,b,user,res,seedProductPrices}))return;}if(p.startsWith('/sales-channels')){const result=salesChannelRoute({db,p,method,b,user,res,send});if(result!==null)return result;}if(p.startsWith('/discount-catalog')){const result=catalogRoute({db,p,method,b,user,res,send,bad});if(result!==null)return result;}if(p.startsWith('/shift-analytics'))return handleShiftAnalytics(url,method,res,db,user,b);if(p.startsWith('/stock-control'))return handleStockControl(url,method,res,db,user,b);if(p.startsWith('/shift-reconciliation'))return handleShiftReconciliation(url,method,res,db,user,b);if(p.startsWith('/purchasing'))return handlePurchasing(url,method,res,db,user,b);if(p.startsWith('/recipe-costing'))return handleRecipeCosting(url,method,res,db,user,b);if(p.startsWith('/food-model'))return handleFoodModel(url,method,res,db,user,b);if(p.startsWith('/reports'))return handleReporting(url,method,res,db,user);if(p==='/logout'&&method==='POST'){const t=bearerSession(req)||cookieSession(req);if(t)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(cryptoHash(t));const c=cookieSession(req);if(c&&c!==t)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(cryptoHash(c));res.setHeader('Set-Cookie',sessionCookie('',0));return send(res,200,{ok:true})}
if(process.env.V5_KDS_ROUTING_ENABLED==='1'&&p==='/kds-config')return kdsConfigRoute({db,p,method,user,b,res,send});if(process.env.V5_KDS_ROUTING_ENABLED==='1'&&p.startsWith('/kds-outbox'))return kdsOutboxRoute({db,p,method,user,res,send});if(p.startsWith('/modifier-groups')||p.startsWith('/modifier-options/')||p.endsWith('/modifier-groups')){const result=modifierRoutes({db,p,method,b,user,res,send});if(result!==null)return result;}if(p.startsWith('/approvals')){const result=approvalRoutes({db,p,method,b,user,send,res,bad,manager,getShift,authorize});if(result!==null)return result;}if(p==='/health')return send(res,200,{ok:true});if(p==='/managers'&&method==='GET')return send(res,200,db.prepare("SELECT users.id,users.username FROM users JOIN manager_pins ON manager_pins.user_id=users.id WHERE users.role IN ('Manager','Owner') AND users.a