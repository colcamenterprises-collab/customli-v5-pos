import {randomUUID} from 'node:crypto';

const defaults=['Fresh Food','Frozen Food','Shelf Items','Beverages','Packaging','Admin','Cleaning'];
const units={g:['g',1],kg:['g',1000],ml:['ml',1],L:['ml',1000],each:['each',1]};
const stamp=()=>new Date().toISOString();
const error=(status,message)=>{throw Object.assign(new Error(message),{status})};
const name=(value,field,max=120)=>{const text=String(value??'').trim();if(!text||text.length>max)error(400,'Enter a valid '+field+'.');return text};
const optional=(value,max=500)=>String(value??'').trim().slice(0,max);
const positive=(value,field)=>{const number=Number(value);if(!Number.isFinite(number)||number<=0||number>1e9)error(400,'Enter a valid '+field+'.');return number};
const money=(value,field='purchase cost')=>{const number=Number(value);if(!Number.isFinite(number)||number<0||number>1e9||Math.round(number*100)!==number*100)error(400,'Enter a valid '+field+'.');return Math.round(number*100)};
const amount=(value,field)=>{if(!Number.isSafeInteger(value)||value<0||value>1e11)error(400,'Enter a valid '+field+'.');return value};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
const audit=(db,user,type,id,action)=>db.prepare('INSERT INTO food_model_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,type,id,action,stamp());
const columns={brand:"TEXT NOT NULL DEFAULT ''",supplier_id:'TEXT',supplier_sku:"TEXT NOT NULL DEFAULT ''",supplier_product_name:"TEXT NOT NULL DEFAULT ''",supplier_url:"TEXT NOT NULL DEFAULT ''",currency:"TEXT NOT NULL DEFAULT 'THB'",category_id:'TEXT',pack_type:"TEXT NOT NULL DEFAULT ''",units_per_pack:'REAL NOT NULL DEFAULT 1',each_quantity:'REAL NOT NULL DEFAULT 1',each_unit:"TEXT NOT NULL DEFAULT 'each'",equivalence_key:"TEXT NOT NULL DEFAULT ''",active:'INTEGER NOT NULL DEFAULT 1',notes:"TEXT NOT NULL DEFAULT ''",promotion:"TEXT NOT NULL DEFAULT ''",external_id:"TEXT NOT NULL DEFAULT ''",last_updated:'TEXT'};

export function migratePurchasing(db){
 // The legacy table made names globally unique. Equivalent products from different
 // suppliers need separate records; keep every ID and foreign-key relationship.
 const legacySql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='food_ingredients'").get()?.sql||'';
 if(/name\s+TEXT\s+NOT\s+NULL\s+UNIQUE\s+COLLATE\s+NOCASE/i.test(legacySql)){
  const rebuilt=legacySql.replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+food_ingredients/i,'CREATE TABLE food_ingredients_rebuild').replace(/name\s+TEXT\s+NOT\s+NULL\s+UNIQUE\s+COLLATE\s+NOCASE/i,'name TEXT NOT NULL COLLATE NOCASE');
  db.exec('PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE');
  try{db.exec(rebuilt);db.exec('INSERT INTO food_ingredients_rebuild SELECT * FROM food_ingredients;DROP TABLE food_ingredients;ALTER TABLE food_ingredients_rebuild RENAME TO food_ingredients;COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e}finally{db.exec('PRAGMA foreign_keys=ON')}
 }
 db.exec(`CREATE TABLE IF NOT EXISTS purchasing_suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,contact_name TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',website TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS purchasing_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS purchasing_price_history(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES food_ingredients(id) ON DELETE RESTRICT,previous_minor INTEGER NOT NULL,new_minor INTEGER NOT NULL,change_minor INTEGER NOT NULL,change_percent REAL,effective_date TEXT NOT NULL,recorded_at TEXT NOT NULL,actor_id TEXT NOT NULL,source TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS purchasing_price_item ON purchasing_price_history(item_id,recorded_at DESC);`);
 const existing=new Set(db.prepare('PRAGMA table_info(food_ingredients)').all().map(row=>row.name));
 for(const [column,definition] of Object.entries(columns))if(!existing.has(column))db.exec(`ALTER TABLE food_ingredients ADD COLUMN ${column} ${definition}`);
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS purchasing_supplier_sku ON food_ingredients(supplier_id,supplier_sku) WHERE supplier_id IS NOT NULL AND supplier_sku<>'';
 CREATE UNIQUE INDEX IF NOT EXISTS purchasing_supplier_product ON food_ingredients(supplier_id,name COLLATE NOCASE,brand COLLATE NOCASE) WHERE supplier_id IS NOT NULL;
 CREATE INDEX IF NOT EXISTS purchasing_category ON food_ingredients(category_id,active);`);
 for(const value of defaults)db.prepare('INSERT OR IGNORE INTO purchasing_categories(id,name) VALUES(?,?)').run(randomUUID(),value);
 db.prepare("UPDATE food_ingredients SET last_updated=substr(updated_at,1,10) WHERE last_updated IS NULL").run();
}

function history(db,user,id,before,after,effective,source){
 if(before===after)return;
 db.prepare('INSERT INTO purchasing_price_history VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,before,after,after-before,before===0?null:Math.round((after-before)/before*10000)/100,effective,stamp(),user.id,source);
}
export function recordLegacyPriceChange(db,user,id,before,after){if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchasing_price_history'").get())history(db,user,id,before,after,stamp().slice(0,10),'legacy edit')}

const itemQuery=`SELECT i.*,s.name AS supplier,c.name AS category FROM food_ingredients i LEFT JOIN purchasing_suppliers s ON s.id=i.supplier_id LEFT JOIN purchasing_categories c ON c.id=i.category_id`;
function tenantCurrency(db){
 const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='restaurant_setup'").get();
 if(table){const row=db.prepare("SELECT profile_json FROM restaurant_setup WHERE id='primary'").get();if(row){try{const value=JSON.parse(row.profile_json).currency;if(/^[A-Z]{3}$/.test(value))return value}catch{}}}
 return process.env.V5_CURRENCY||'THB';
}
const getItem=(db,id)=>db.prepare(itemQuery+' WHERE i.id=?').get(id);
const norm=value=>String(value??'').trim().toLocaleLowerCase();
function match(db,row){
 let found=null;
 if(row.id){found=getItem(db,String(row.id));if(!found)error(409,'An item selected for update no longer exists. Refresh the preview.');return found}
 if(row.supplierId&&row.supplierSku){found=db.prepare('SELECT id FROM food_ingredients WHERE supplier_id=? AND supplier_sku=? COLLATE NOCASE').get(row.supplierId,row.supplierSku);if(found)return getItem(db,found.id)}
 if(row.supplierSku)return null;
 if(row.externalId){const options=db.prepare('SELECT id,supplier_id FROM food_ingredients WHERE external_id=?').all(row.externalId).filter(x=>!row.supplierId||x.supplier_id===row.supplierId);if(options.length>1)error(409,'Several items share this legacy ID. Choose the correct item.');if(options.length)return getItem(db,options[0].id)}
 const options=db.prepare('SELECT id FROM food_ingredients WHERE name=? COLLATE NOCASE AND brand=? COLLATE NOCASE AND COALESCE(supplier_id,\'\')=?').all(row.name,row.brand||'',row.supplierId||'');
 if(options.length>1)error(409,'Several items match this name. Choose the correct item.');
 return options.length?getItem(db,options[0].id):null;
}
function validate(db,input,existing=null){
 const row={name:name(input.name,'item name'),brand:optional(input.brand,120),supplierId:input.supplierId||null,supplierSku:optional(input.supplierSku,120),supplierProductName:optional(input.supplierProductName,200),supplierUrl:optional(input.supplierUrl,500),currency:name(input.currency||tenantCurrency(db),'currency',3).toUpperCase(),categoryId:input.categoryId||null,packType:optional(input.packType,60),unitsPerPack:positive(input.unitsPerPack??1,'number of units per pack'),eachQuantity:positive(input.eachQuantity??1,'quantity per unit'),eachUnit:input.eachUnit||'each',packQuantity:positive(input.packQuantity,'pack quantity'),packUnit:input.packUnit,equivalenceKey:optional(input.equivalenceKey,120),active:input.active===false||input.active===0?0:1,notes:optional(input.notes,5000),promotion:optional(input.promotion,1000),externalId:optional(input.externalId,120),lastUpdated:input.lastUpdated||stamp().slice(0,10)};
 if(!units[row.packUnit]||!units[row.eachUnit])error(400,'Choose a valid purchase measurement unit.');
 if(!/^\d{4}-\d\d-\d\d$/.test(row.lastUpdated)||Number.isNaN(Date.parse(row.lastUpdated)))error(400,'Choose a valid last updated date.');
 if(!/^[A-Z]{3}$/.test(row.currency))error(400,'Choose a three-letter currency.');
 if(row.supplierUrl){try{const url=new URL(row.supplierUrl);if(!['http:','https:'].includes(url.protocol))throw Error()}catch{error(400,'Enter a valid supplier product URL.')}}
 if(row.supplierId&&!db.prepare('SELECT id FROM purchasing_suppliers WHERE id=?').get(row.supplierId))error(400,'Choose an existing supplier.');
 if(row.categoryId&&!db.prepare('SELECT id FROM purchasing_categories WHERE id=? AND active=1').get(row.categoryId))error(400,'Choose an active purchasing category.');
 const base=units[row.packUnit][0],hasLines=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recipe_cost_lines'").get();if(existing&&existing.base_unit!==base&&(db.prepare('SELECT 1 FROM food_recipe_components WHERE ingredient_id=? LIMIT 1').get(existing.id)||hasLines&&db.prepare('SELECT 1 FROM recipe_cost_lines WHERE item_id=? LIMIT 1').get(existing.id)))error(409,'This item is used in a recipe. Update its recipe quantities before changing measurement type.');
 const purchaseCostMinor=input.purchaseCostMinor!==undefined?amount(input.purchaseCostMinor,'purchase cost'):money(input.purchaseCost,'purchase cost');
 return {...row,baseUnit:base,purchaseCostMinor};
}
const fieldNames=['name','brand','supplierId','supplierSku','supplierProductName','supplierUrl','currency','categoryId','packType','unitsPerPack','eachQuantity','eachUnit','packQuantity','packUnit','baseUnit','purchaseCostMinor','equivalenceKey','active','notes','promotion','externalId','lastUpdated'];
const dbNames=['name','brand','supplier_id','supplier_sku','supplier_product_name','supplier_url','currency','category_id','pack_type','units_per_pack','each_quantity','each_unit','pack_quantity','pack_unit','base_unit','pack_cost_minor','equivalence_key','active','notes','promotion','external_id','last_updated'];
function save(db,user,input,source='manual edit',existing=null){
 const row=validate(db,input,existing),id=existing?.id||randomUUID(),now=stamp();
 if(existing){
  db.prepare(`UPDATE food_ingredients SET ${dbNames.map(x=>x+'=?').join(',')},updated_at=? WHERE id=?`).run(...fieldNames.map(x=>row[x]),now,id);
  history(db,user,id,existing.pack_cost_minor,row.purchaseCostMinor,row.lastUpdated,source);
 }else db.prepare(`INSERT INTO food_ingredients(id,${dbNames.join(',')},updated_at) VALUES(${Array(dbNames.length+2).fill('?').join(',')})`).run(id,...fieldNames.map(x=>row[x]),now);
 audit(db,user,'purchasing_item',id,existing?'updated':'created');return getItem(db,id);
}
function atomicSave(db,user,input,existing=null){db.exec('BEGIN IMMEDIATE');try{const item=save(db,user,input,'manual edit',existing);db.exec('COMMIT');return item}catch(e){db.exec('ROLLBACK');throw e}}
const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const exportFields=['id','name','brand','supplier','supplier_sku','supplier_product_name','supplier_url','pack_cost_minor','currency','pack_type','units_per_pack','each_quantity','each_unit','pack_quantity','pack_unit','base_unit','category','last_updated','active','notes','promotion','external_id','equivalence_key'];
export function handlePurchasing(url,method,res,db,user,body){
 const path=url.pathname.replace(/^\/(?:v5|v5-test)\/api(?=\/|$)/,'');if(!path.startsWith('/purchasing'))return false;
 try{
  if(user.permissions?!user.permissions.has('operations.purchasing'):user.role!=='Owner')error(403,'Purchasing access is required.');
  if(user.tenantId&&process.env.PLATFORM_TENANT_ID&&user.tenantId!==process.env.PLATFORM_TENANT_ID)error(403,'This restaurant is unavailable.');
  const p=path.slice('/purchasing'.length).split('/').filter(Boolean),b=body||{};
  if(p[0]==='config'&&method==='GET'){send(res,200,{currency:tenantCurrency(db)});return true}
  if(p[0]==='categories'||p[0]==='suppliers'){
   const categories=p[0]==='categories',table=categories?'purchasing_categories':'purchasing_suppliers';
   if(method==='GET'){send(res,200,{[p[0]]:db.prepare(`SELECT * FROM ${table} ORDER BY name COLLATE NOCASE`).all()});return true}
   if(!['POST','PATCH'].includes(method))error(405,'This action is unavailable.');
   const value=name(b.name,categories?'category name':'supplier name');let id=p[1]||randomUUID();
   if(method==='PATCH'&&!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))error(404,'Record not found.');
   const active=b.active===false||b.active===0?0:1;
   if(categories){
    if(method==='POST')db.prepare('INSERT INTO purchasing_categories(id,name,active) VALUES(?,?,?)').run(id,value,active);
    else db.prepare('UPDATE purchasing_categories SET name=?,active=? WHERE id=?').run(value,active,id);
   }else{
    const before=method==='PATCH'?db.prepare('SELECT * FROM purchasing_suppliers WHERE id=?').get(id):null;
    const details=[value,optional(b.contactName??before?.contact_name,120),optional(b.email??before?.email,200),optional(b.phone??before?.phone,80),optional(b.website??before?.website,500),active];
    if(details[2]&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details[2]))error(400,'Enter a valid supplier email.');
    if(details[4]){try{const url=new URL(details[4]);if(!['http:','https:'].includes(url.protocol))throw Error()}catch{error(400,'Enter a valid supplier website URL.')}}
    if(method==='POST')db.prepare('INSERT INTO purchasing_suppliers(id,name,contact_name,email,phone,website,active) VALUES(?,?,?,?,?,?,?)').run(id,...details);
    else db.prepare('UPDATE purchasing_suppliers SET name=?,contact_name=?,email=?,phone=?,website=?,active=? WHERE id=?').run(...details,id);
   }
   audit(db,user,p[0],id,method==='POST'?'created':'updated');send(res,200,{record:db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)});return true;
  }
  if(p[0]==='export'&&method==='GET'){
   const ids=url.searchParams.get('ids')?.split(',').filter(Boolean)||null;
   if(ids?.length>5000)error(400,'Select fewer items for export.');
   const all=db.prepare(itemQuery+' ORDER BY i.name COLLATE NOCASE').all().filter(r=>!ids||ids.includes(r.id));
   const csv=[exportFields.map(csvCell).join(','),...all.map(r=>exportFields.map(f=>csvCell(r[f])).join(','))].join('\r\n')+'\r\n';
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="purchasing.csv"','Cache-Control':'no-store'});res.end('\uFEFF'+csv);return true;
  }
  if(p[0]==='price-update'&&method==='POST'){
   if(!Array.isArray(b.records)||!b.records.length||b.records.length>500)error(400,'Choose 1 to 500 supplier prices.');
   const seen=new Set(),proposals=b.records.map((r,index)=>{
    const supplier=r.supplierId?db.prepare('SELECT id FROM purchasing_suppliers WHERE id=?').get(r.supplierId):db.prepare('SELECT id FROM purchasing_suppliers WHERE name=? COLLATE NOCASE').get(r.supplier||'');
    if(!supplier)error(400,'Row '+(index+1)+': choose a known supplier.');
    const sku=name(r.supplierSku,'supplier SKU');const id=db.prepare('SELECT id FROM food_ingredients WHERE supplier_id=? AND supplier_sku=? COLLATE NOCASE').get(supplier.id,sku)?.id;
    if(!id)error(409,'Row '+(index+1)+': no purchasing item matches this supplier and SKU.');
    if(seen.has(id))error(409,'The same supplier SKU appears twice in the upload.');seen.add(id);
    const item=getItem(db,id),newCost=r.purchaseCostMinor!==undefined?amount(r.purchaseCostMinor,'purchase cost'):money(r.purchaseCost);
    const effective=r.lastUpdated||stamp().slice(0,10);if(!/^\d{4}-\d\d-\d\d$/.test(effective)||Number.isNaN(Date.parse(effective)))error(400,'Row '+(index+1)+': choose a valid effective date.');
    return {id,name:item.name,previousCostMinor:item.pack_cost_minor,newCostMinor:newCost,updatedAt:item.updated_at,effective};
   });
   const expected=proposals.map(({id,updatedAt})=>({id,updatedAt}));
   if(b.confirm!==true){send(res,200,{proposals,summary:{create:0,update:proposals.length,newSuppliers:[],newCategories:[]}});return true}
   if(JSON.stringify(b.expected)!==JSON.stringify(expected))error(409,'Prices changed since preview. Review the update again.');
   db.exec('BEGIN IMMEDIATE');try{for(const row of proposals){db.prepare('UPDATE food_ingredients SET pack_cost_minor=?,last_updated=?,updated_at=? WHERE id=?').run(row.newCostMinor,row.effective,stamp(),row.id);history(db,user,row.id,row.previousCostMinor,row.newCostMinor,row.effective,'supplier price update');audit(db,user,'purchasing_item',row.id,'supplier_price_updated')}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
   send(res,200,{ok:true,created:0,updated:proposals.length,atomic:true});return true;
  }
  if(p[0]==='import'&&method==='POST'){
   if(!Array.isArray(b.records)||!b.records.length||b.records.length>500)error(400,'Choose 1 to 500 purchasing rows.');
   const proposals=[],seen=new Set(),newSuppliers=new Set(),newCategories=new Set();
   for(const [index,r] of b.records.entries()){
    const supplier=r.supplierId?db.prepare('SELECT id FROM purchasing_suppliers WHERE id=?').get(r.supplierId):r.supplier?db.prepare('SELECT id FROM purchasing_suppliers WHERE name=? COLLATE NOCASE').get(r.supplier):null;
    if(r.supplier&&!supplier)newSuppliers.add(name(r.supplier,'supplier name'));
    const category=r.categoryId?db.prepare('SELECT id FROM purchasing_categories WHERE id=?').get(r.categoryId):r.category?db.prepare('SELECT id FROM purchasing_categories WHERE name=? COLLATE NOCASE').get(r.category):null;
    if(r.category&&!category)newCategories.add(name(r.category,'category name'));
    const prepared={...r,supplierId:supplier?.id||r.supplierId||null,categoryId:category?.id||r.categoryId||null};
    const existing=match(db,prepared);const row=validate(db,prepared,existing);
    const key=existing?.id||norm((row.supplierId||r.supplier)+'|'+row.supplierSku+'|'+row.name+'|'+row.brand);
    if(seen.has(key))error(409,'The upload contains the same item more than once. Review row '+(index+1)+'.');seen.add(key);
    if(!existing&&db.prepare('SELECT id FROM food_ingredients WHERE name=? COLLATE NOCASE AND COALESCE(supplier_id,\'\')=? AND brand=? COLLATE NOCASE').get(row.name,row.supplierId||'',row.brand))error(409,'Row '+(index+1)+': an item with this supplier, brand and name already exists. Choose it explicitly.');
    proposals.push({index,action:existing?'update':'create',id:existing?.id||null,name:row.name,previousCostMinor:existing?.pack_cost_minor??null,newCostMinor:row.purchaseCostMinor,updatedAt:existing?.updated_at||null,prepared});
   }
   if(b.confirm!==true){send(res,200,{proposals,summary:{create:proposals.filter(p=>p.action==='create').length,update:proposals.filter(p=>p.action==='update').length,newSuppliers:[...newSuppliers],newCategories:[...newCategories]}});return true}
   if(!Array.isArray(b.expected)||JSON.stringify(b.expected)!==JSON.stringify(proposals.map(({action,id,updatedAt})=>({action,id,updatedAt}))))error(409,'The purchasing list changed since preview. Review the upload again.');
   db.exec('BEGIN IMMEDIATE');try{
    for(const supplier of newSuppliers){const id=randomUUID();const result=db.prepare('INSERT OR IGNORE INTO purchasing_suppliers(id,name) VALUES(?,?)').run(id,supplier);if(result.changes)audit(db,user,'suppliers',id,'created_by_import')}
    for(const category of newCategories){const id=randomUUID();const result=db.prepare('INSERT OR IGNORE INTO purchasing_categories(id,name) VALUES(?,?)').run(id,category);if(result.changes)audit(db,user,'categories',id,'created_by_import')}
    for(const proposal of proposals){const r=proposal.prepared;
     if(!r.supplierId&&r.supplier)r.supplierId=db.prepare('SELECT id FROM purchasing_suppliers WHERE name=? COLLATE NOCASE').get(r.supplier).id;
     if(!r.categoryId&&r.category)r.categoryId=db.prepare('SELECT id FROM purchasing_categories WHERE name=? COLLATE NOCASE').get(r.category).id;
     save(db,user,r,'CSV or XLSX import',proposal.id?getItem(db,proposal.id):null);
    }db.exec('COMMIT')
   }catch(e){db.exec('ROLLBACK');throw e}
   send(res,200,{ok:true,created:proposals.filter(p=>p.action==='create').length,updated:proposals.filter(p=>p.action==='update').length,atomic:true});return true;
  }
  if(p[0]==='items'&&p.length===1&&method==='GET'){
   const items=db.prepare(itemQuery+' ORDER BY i.name COLLATE NOCASE').all();send(res,200,{items});return true;
  }
  if(p[0]==='items'&&p[1]&&p[2]==='history'&&method==='GET'){
   if(!getItem(db,p[1]))error(404,'Item not found.');send(res,200,{history:db.prepare('SELECT * FROM purchasing_price_history WHERE item_id=? ORDER BY recorded_at DESC').all(p[1])});return true;
  }
  if(p[0]==='items'&&method==='POST'&&!p[1]){const item=atomicSave(db,user,b);send(res,201,{item});return true}
  if(p[0]==='items'&&p[1]){
   const existing=getItem(db,p[1]);if(!existing)error(404,'Item not found.');
   if(method==='PATCH'){
    const merged={...existing,name:b.name??existing.name,brand:b.brand??existing.brand,supplierId:b.supplierId??existing.supplier_id,supplierSku:b.supplierSku??existing.supplier_sku,supplierProductName:b.supplierProductName??existing.supplier_product_name,supplierUrl:b.supplierUrl??existing.supplier_url,categoryId:b.categoryId??existing.category_id,packType:b.packType??existing.pack_type,unitsPerPack:b.unitsPerPack??existing.units_per_pack,eachQuantity:b.eachQuantity??existing.each_quantity,eachUnit:b.eachUnit??existing.each_unit,packQuantity:b.packQuantity??existing.pack_quantity,packUnit:b.packUnit??existing.pack_unit,purchaseCostMinor:b.purchaseCostMinor??existing.pack_cost_minor,lastUpdated:b.lastUpdated??existing.last_updated,notes:b.notes??existing.notes,promotion:b.promotion??existing.promotion,externalId:b.externalId??existing.external_id,equivalenceKey:b.equivalenceKey??existing.equivalence_key,active:b.active??existing.active};
    const item=atomicSave(db,user,merged,existing);send(res,200,{item});return true;
   }
   if(method==='DELETE'){
    const modifierTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='food_modifier_ingredients'").get();
    const recipeLines=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recipe_cost_lines'").get();
    if(db.prepare('SELECT 1 FROM food_recipe_components WHERE ingredient_id=? LIMIT 1').get(p[1])||recipeLines&&db.prepare('SELECT 1 FROM recipe_cost_lines WHERE item_id=? LIMIT 1').get(p[1])||modifierTable&&db.prepare('SELECT 1 FROM food_modifier_ingredients WHERE ingredient_id=? LIMIT 1').get(p[1]))error(409,'This item is used in costing. Deactivate it instead.');
    db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM purchasing_price_history WHERE item_id=?').run(p[1]);db.prepare('DELETE FROM food_ingredients WHERE id=?').run(p[1]);audit(db,user,'purchasing_item',p[1],'deleted');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send(res,200,{ok:true});return true;
   }
  }
  error(405,'This action is unavailable.');
 }catch(e){const conflict=e.code?.startsWith('SQLITE_CONSTRAINT');send(res,e.status|| (conflict?409:500),{message:e.status?e.message:conflict?'An item with these details already exists.':'Purchasing could not be saved.'});return true}
}
