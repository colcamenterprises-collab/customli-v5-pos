import {randomUUID} from 'node:crypto';

const accessModes=new Set(['cashier','manager_pin','manager_only']);
const validateAccess=(value,bad)=>{
 if(!accessModes.has(value))bad(400,'Choose a valid cashier permission');
 return value;
};
export function installDiscountCatalog(db){
 db.exec(`CREATE TABLE IF NOT EXISTS discount_catalog(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),value INTEGER NOT NULL CHECK(value>0),active INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,access_mode TEXT NOT NULL DEFAULT 'manager_pin' CHECK(access_mode IN ('cashier','manager_pin','manager_only')));
 CREATE TABLE IF NOT EXISTS discount_catalog_audit(id TEXT PRIMARY KEY,discount_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(discount_catalog)').all().some(c=>c.name==='access_mode'))db.exec("ALTER TABLE discount_catalog ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'manager_pin' CHECK(access_mode IN ('cashier','manager_pin','manager_only'))");
 if(!db.prepare('PRAGMA table_info(discounts)').all().some(c=>c.name==='catalog_id'))db.exec('ALTER TABLE discounts ADD COLUMN catalog_id TEXT');
}
export function catalogRoute({db,p,method,b,user,res,send,bad}){
 if(p==='/discount-catalog'&&method==='GET'){
  const rows=db.prepare("SELECT id,name,kind,value,active,access_mode FROM discount_catalog WHERE (active=1 OR ?=1) AND (?<>'Cashier' OR access_mode<>'manager_only') ORDER BY name").all(user.role==='Owner'?1:0,user.role);
  return send(res,200,rows);
 }
 if(p==='/discount-catalog'&&method==='POST'){
  if(user.role!=='Owner')bad(403,'Only Owners can manage discounts');
  const name=String(b.name||'').trim(),kind=String(b.kind||''),value=Number(b.value),access_mode=validateAccess(b.accessMode??'manager_pin',bad);
  if(name.length<2||name.length>70||!['percent','fixed'].includes(kind)||!Number.isSafeInteger(value)||value<=0||(kind==='percent'&&value>10000))bad(400,'Enter a valid name and discount value');
  const id=randomUUID(),now=new Date().toISOString();
  db.prepare('INSERT INTO discount_catalog(id,name,kind,value,access_mode,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,name,kind,value,access_mode,user.id,now,now);
  db.prepare('INSERT INTO discount_catalog_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),id,user.id,'create',JSON.stringify({name,kind,value,access_mode}),now);
  return send(res,201,{id,name,kind,value,active:1,access_mode});
 }
 const match=p.match(/^\/discount-catalog\/([\w-]+)$/);
 if(match&&method==='PATCH'){
  if(user.role!=='Owner')bad(403,'Only Owners can manage discounts');
  const id=match[1],existing=db.prepare('SELECT * FROM discount_catalog WHERE id=?').get(id);
  if(!existing)bad(404,'Discount not found');
  const name=String(b.name??existing.name).trim(),kind=String(b.kind??existing.kind),value=Number(b.value??existing.value),active=b.active===undefined?existing.active:(b.active?1:0),access_mode=validateAccess(b.accessMode??existing.access_mode,bad);
  if(name.length<2||name.length>70||!['percent','fixed'].includes(kind)||!Number.isSafeInteger(value)||value<=0||(kind==='percent'&&value>10000))bad(400,'Enter a valid name and discount value');
  const now=new Date().toISOString();
  db.prepare('UPDATE discount_catalog SET name=?,kind=?,value=?,active=?,access_mode=?,updated_at=? WHERE id=?').run(name,kind,value,active,access_mode,now,id);
  db.prepare('INSERT INTO discount_catalog_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),id,user.id,'update',JSON.stringify({previous:existing,current:{name,kind,value,active,access_mode}}),now);
  return send(res,200,{id,name,kind,value,active,access_mode});
 }
 return null;
}
