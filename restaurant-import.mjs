import {randomUUID} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const norm=s=>String(s??'').trim().toLowerCase();
const label=(s,max=120)=>{const v=String(s??'').trim();if(!v||v.length>max)fail(400,'A required name is missing or too long.');return v};
const num=(v,name,min=0,max=1e9)=>{const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)fail(400,'Invalid '+name+'.');return n};
const minor=(v,name)=>{const n=num(v,name);return Math.round(n*100)};
const units={g:'g',kg:'g',ml:'ml',L:'ml',each:'each'};
const lookup=(db,sql,arg)=>db.prepare(sql).get(arg);
export function handleBatchImport({db,p,method,b,user,res}){
 if(p!=='/restaurant-import/batch')return false;
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
 if(user.role!=='Owner')fail(403,'Only the restaurant owner can import records.');
 if(method!=='POST')fail(405,'This action requires an approved upload.');
 const kind=String(b?.kind||''),rows=b?.records;
 if(!['categories','menu','ingredients','recipes'].includes(kind))fail(400,'Choose a supported import type.');
 if(!Array.isArray(rows)||!rows.length||rows.length>500)fail(400,'Choose between 1 and 500 records.');
 const seen=new Set(),prepared=[],now=new Date().toISOString();
 for(const [i,r] of rows.entries()){
  const name=label(r.name),key=norm(name);if(seen.has(key))fail(400,'Duplicate '+name+' in upload.');seen.add(key);
  if(kind==='categories'){
   if(lookup(db,'SELECT id FROM categories WHERE name=? COLLATE NOCASE',name))fail(409,'Category already exists: '+name);
   prepared.push({name});
  }else if(kind==='menu'){
   const category=label(r.category,80),price=minor(r.price,'selling price'),description=String(r.description||'').trim().slice(0,1000);
   // Categories supplied by menu CSV are created in the same transaction as menu items.
   if(lookup(db,'SELECT id FROM products WHERE name=? COLLATE NOCASE',name))fail(409,'Menu item already exists: '+name);
   prepared.push({name,category,price,description});
  }else if(kind==='ingredients'){
   const packUnit=String(r.packUnit||''),baseUnit=units[packUnit];if(!baseUnit)fail(400,'Choose g, kg, ml, L or each for '+name);
   const packQuantity=num(r.packQuantity,'pack quantity',0.000001,1e6),packCostMinor=minor(r.packCost,'pack cost');
   if(lookup(db,'SELECT id FROM food_ingredients WHERE name=? COLLATE NOCASE',name))fail(409,'Ingredient already exists: '+name);
   prepared.push({name,packUnit,baseUnit,packQuantity,packCostMinor});
  }else{
   const components=r.components;if(!Array.isArray(components)||!components.length||components.length>100)fail(400,'Add ingredients to '+name);
   if(lookup(db,'SELECT id FROM food_recipes WHERE name=? COLLATE NOCASE',name))fail(409,'Recipe already exists: '+name);
   const product=r.product?lookup(db,'SELECT id FROM products WHERE name=? COLLATE NOCASE AND active=1',label(r.product)):null;
   if(r.product&&!product)fail(400,'Menu item not found: '+r.product);
   if(product&&lookup(db,'SELECT id FROM food_recipes WHERE product_id=?',product.id))fail(409,'Menu item already has a recipe: '+r.product);
   const ids=new Set(),resolved=components.map(c=>{const ing=lookup(db,'SELECT id FROM food_ingredients WHERE name=? COLLATE NOCASE',label(c.ingredient));if(!ing)fail(400,'Ingredient not found: '+c.ingredient);if(ids.has(ing.id))fail(400,'Duplicate ingredient in '+name);ids.add(ing.id);return {id:ing.id,quantity:num(c.quantity,'ingredient quantity',0.000001,1e6)}});
   const yieldQuantity=num(r.yieldQuantity??1,'recipe yield',0.000001,1e6),packagingCostMinor=minor(r.packagingCost||0,'packaging cost'),wastePercent=num(r.wastePercent||0,'waste percent',0,100);
   prepared.push({name,productId:product?.id||null,components:resolved,yieldQuantity,packagingCostMinor,wastePercent});
  }
 }
 // Validate every row before starting, then commit all writes as one SQLite transaction.
 db.exec('BEGIN IMMEDIATE');
 try{
  if(kind==='menu'){
   const categories=new Map();
   for(const r of prepared){const key=norm(r.category);if(!categories.has(key))categories.set(key,r.category)}
   const findCategory=db.prepare('SELECT id,name,active FROM categories WHERE name=? COLLATE NOCASE');
   const insertCategory=db.prepare('INSERT INTO categories(id,name,sort_order,image,icon) VALUES(?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM categories),?,?)');
   for(const category of categories.values()){const existing=findCategory.get(category);if(existing){if(existing.active!==1)fail(409,'Category is inactive: '+category+'. Reactivate it before importing.')}else insertCategory.run(randomUUID(),category,'','')}
  }
  for(const r of prepared){
   const id=randomUUID();
   if(kind==='categories')db.prepare('INSERT INTO categories(id,name,sort_order,image,icon) VALUES(?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM categories),?,?)').run(id,r.name,'','');
   else if(kind==='menu')db.prepare("INSERT INTO products(id,name,category,price,active,description) VALUES(?,?,?,?,1,?)").run(id,r.name,r.category,r.price,r.description);
   else if(kind==='ingredients')db.prepare('INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,r.name,r.baseUnit,r.packQuantity,r.packUnit,r.packCostMinor,now);
   else {db.prepare('INSERT INTO food_recipes(id,name,yield_quantity,packaging_cost_minor,waste_percent,target_price_minor,product_id,instructions,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,r.name,r.yieldQuantity,r.packagingCostMinor,r.wastePercent,null,r.productId,'',now);const ins=db.prepare('INSERT INTO food_recipe_components(recipe_id,ingredient_id,quantity) VALUES(?,?,?)');for(const c of r.components)ins.run(id,c.id,c.quantity)}
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 send(201,{ok:true,kind,inserted:prepared.length,atomic:true});return true;
 }catch(e){send(e.status||500,{message:e.status?e.message:'The import was not saved. Please try again.'});return true}
}
