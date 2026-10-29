const bad=(status,message)=>{throw Object.assign(new Error(message),{status})};
const cleanName=value=>{const n=String(value||'').trim();if(!/^[\w][\w -]{1,45}$/.test(n))bad(400,'Station names must be 2–46 letters, numbers or spaces.');return n};
export function migrateKdsConfig(db){
 db.exec(`CREATE TABLE IF NOT EXISTS kds_stations(name TEXT PRIMARY KEY,active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS kds_product_routes(product_id TEXT PRIMARY KEY REFERENCES products(id),station TEXT NOT NULL REFERENCES kds_stations(name));
 CREATE TABLE IF NOT EXISTS kds_option_routes(option_id TEXT PRIMARY KEY REFERENCES modifier_options(id),station TEXT NOT NULL REFERENCES kds_stations(name));
 CREATE TABLE IF NOT EXISTS kds_config_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,details TEXT NOT NULL);`);
 for(const [n,i] of [[process.env.V5_KDS_DEFAULT_STATION||'QA Prep',0],['Expo',1]])db.prepare('INSERT OR IGNORE INTO kds_stations(name,sort_order) VALUES(?,?)').run(n,i);
 // The initial QA menu was previously routed to QA Prep. Preserve that default
 // for existing items while requiring explicit routes for newly added products.
 const seeded=db.prepare('SELECT COUNT(*) AS n FROM kds_product_routes').get().n;
 if(seeded===0)for(const p of db.prepare('SELECT id FROM products WHERE active=1').all())db.prepare('INSERT OR IGNORE INTO kds_product_routes(product_id,station) VALUES(?,?)').run(p.id,process.env.V5_KDS_DEFAULT_STATION||'QA Prep');
}
export function readKdsConfig(db){
 return {
  environment:process.env.V5_KDS_ENV||'test',
  stations:db.prepare('SELECT name,sort_order FROM kds_stations WHERE active=1 ORDER BY sort_order,name').all(),
  products:db.prepare('SELECT p.id,p.name,p.category,pr.station FROM products p LEFT JOIN kds_product_routes pr ON pr.product_id=p.id WHERE p.active=1 ORDER BY p.category,p.name').all(),
  options:db.prepare('SELECT o.id,o.name,g.name AS groupName,oroute.station FROM modifier_options o JOIN modifier_groups g ON o.group_id=g.id LEFT JOIN kds_option_routes oroute ON oroute.option_id=o.id WHERE o.active=1 AND g.active=1 ORDER BY g.name,o.name').all()
 }
}
export function kdsConfigRoute({db,p,method,user,b,res,send}){
 if(p!=='/kds-config')return null;
 if(user.role!=='Owner')bad(403,'Only an Owner can configure kitchen routing.');
 if(method==='GET')return send(res,200,readKdsConfig(db));
 if(method!=='POST')bad(405,'Unsupported kitchen configuration request.');
 const stations=b.stations,routes=b.routes,optionRoutes=b.optionRoutes||[];
 if(!Array.isArray(stations)||!Array.isArray(routes)||!Array.isArray(optionRoutes)||stations.length>20||routes.length>2500||optionRoutes.length>2500)bad(400,'Kitchen settings are invalid.');
 const names=stations.map(cleanName);
 if(!names.includes('Expo')||names.length<2||new Set(names).size!==names.length)bad(400,'Include Expo and at least one preparation station.');
 if(new Set(routes.map(r=>r.productId)).size!==routes.length||new Set(optionRoutes.map(r=>r.optionId)).size!==optionRoutes.length)bad(400,'Each item can have only one station assignment.');
 for(const line of routes){
  if(!db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(line.productId)||!names.includes(line.station)||line.station==='Expo')bad(400,'Choose an active preparation station for every routed item.');
 }
 for(const line of optionRoutes){
  if(!db.prepare('SELECT 1 FROM modifier_options WHERE id=? AND active=1').get(line.optionId)||!names.includes(line.station)||line.station==='Expo')bad(400,'Choose a valid option station.');
 }
 // Do not silently discard routes for active menu items.
 const productCount=db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1').get().n;
 if(routes.length!==productCount)bad(400,'Assign every active menu item to a kitchen station before saving.');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare('DELETE FROM kds_option_routes').run();
  db.prepare('DELETE FROM kds_product_routes').run();
  db.prepare('DELETE FROM kds_stations').run();
  const addStation=db.prepare('INSERT INTO kds_stations(name,sort_order) VALUES(?,?)');
  names.forEach((n,i)=>addStation.run(n,i));
  const addRoute=db.prepare('INSERT INTO kds_product_routes(product_id,station) VALUES(?,?)');
  routes.forEach(x=>addRoute.run(x.productId,x.station));
  const addOption=db.prepare('INSERT INTO kds_option_routes(option_id,station) VALUES(?,?)');
  optionRoutes.forEach(x=>addOption.run(x.optionId,x.station));
  db.prepare('INSERT INTO kds_config_audit(actor_id,occurred_at,details) VALUES(?,?,?)').run(user.id,new Date().toISOString(),JSON.stringify({stations:names,products:routes.length,options:optionRoutes.length}));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 return send(res,200,readKdsConfig(db));
}

export function kdsOutboxRoute({db,p,method,user,res,send}){
 if(!p.startsWith('/kds-outbox'))return null;
 if(user.role!=='Owner')bad(403,'Only an Owner can manage kitchen deliveries.');
 if(p==='/kds-outbox'&&method==='GET'){
  const counters=db.prepare('SELECT status,COUNT(*) AS count FROM kitchen_outbox GROUP BY status').all();
  const failed=db.prepare("SELECT o.id,o.receipt_number,k.attempts,k.last_error,k.created_at FROM kitchen_outbox k JOIN orders o ON o.id=k.order_id WHERE k.status='failed' ORDER BY k.created_at DESC LIMIT 20").all();
  return send(res,200,{counts:Object.fromEntries(counters.map(x=>[x.status,x.count])),failed});
 }
 if(p==='/kds-outbox/retry'&&method==='POST'){
  const result=db.prepare("UPDATE kitchen_outbox SET status='pending',attempts=0,last_error=NULL WHERE status='failed'").run();
  db.prepare('INSERT INTO kds_config_audit(actor_id,occurred_at,details) VALUES(?,?,?)').run(user.id,new Date().toISOString(),JSON.stringify({action:'retry_failed_kitchen_orders',count:result.changes}));
  return send(res,200,{retrying:result.changes});
 }
 bad(405,'Unsupported kitchen delivery action.');
}
