import {randomUUID} from 'node:crypto';

const units={g:['g',1],kg:['g',1000],ml:['ml',1],L:['ml',1000],each:['each',1]};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const string=(v,max=5000)=>String(v??'').trim().slice(0,max);
const positive=(v,field)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||n>1e7)fail(400,'Enter a valid '+field+'.');return n};
const percent=(v,field)=>{const n=Number(v||0);if(!Number.isFinite(n)||n<0||n>100)fail(400,'Enter a valid '+field+' between 0 and 100.');return n};
const minor=(v,field)=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>1e11)fail(400,'Enter a valid '+field+'.');return n};
const properties={description:"TEXT NOT NULL DEFAULT ''",category:"TEXT NOT NULL DEFAULT ''",yield_unit:"TEXT NOT NULL DEFAULT 'portion'",image_url:"TEXT NOT NULL DEFAULT ''",status:"TEXT NOT NULL DEFAULT 'Draft'",delivery_price_minor:'INTEGER',direct_price_minor:'INTEGER',suggested_price_minor:'INTEGER',notes:"TEXT NOT NULL DEFAULT ''",historical_metadata:"TEXT NOT NULL DEFAULT '{}'",active:'INTEGER NOT NULL DEFAULT 1'};
export function migrateRecipeCosting(db){
 const existing=new Set(db.prepare('PRAGMA table_info(food_recipes)').all().map(x=>x.name));
 for(const [column,definition] of Object.entries(properties))if(!existing.has(column))db.exec(`ALTER TABLE food_recipes ADD COLUMN ${column} ${definition}`);
 db.exec(`CREATE TABLE IF NOT EXISTS recipe_cost_lines(id TEXT PRIMARY KEY,recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,item_id TEXT NOT NULL REFERENCES food_ingredients(id) ON DELETE RESTRICT,line_type TEXT NOT NULL CHECK(line_type IN ('ingredient','packaging')),quantity REAL NOT NULL CHECK(quantity>0),unit_used TEXT NOT NULL,waste_percent REAL NOT NULL DEFAULT 0,manual_unit_cost_minor INTEGER,notes TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS recipe_cost_lines_recipe ON recipe_cost_lines(recipe_id);
 CREATE TABLE IF NOT EXISTS recipe_menu_links(recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id),PRIMARY KEY(recipe_id,product_id));`);
 // Existing ingredient IDs and quantities are copied without conversion.
 db.prepare("INSERT INTO recipe_cost_lines(id,recipe_id,item_id,line_type,quantity,unit_used,waste_percent) SELECT lower(hex(randomblob(16))),c.recipe_id,c.ingredient_id,'ingredient',c.quantity,i.base_unit,0 FROM food_recipe_components c JOIN food_ingredients i ON i.id=c.ingredient_id WHERE NOT EXISTS(SELECT 1 FROM recipe_cost_lines l WHERE l.recipe_id=c.recipe_id AND l.item_id=c.ingredient_id AND l.line_type='ingredient')").run();
 db.prepare('INSERT OR IGNORE INTO recipe_menu_links(recipe_id,product_id) SELECT id,product_id FROM food_recipes WHERE product_id IS NOT NULL').run();
}
export function costRecipe(db,recipe){
 const lines=db.prepare('SELECT l.*,i.name,i.pack_quantity,i.pack_unit,i.pack_cost_minor,i.active,i.category_id FROM recipe_cost_lines l JOIN food_ingredients i ON i.id=l.item_id WHERE l.recipe_id=? ORDER BY l.line_type,l.rowid').all(recipe.id);
 const costed=lines.map(l=>{const purchase=units[l.pack_unit],used=units[l.unit_used];const valid=!!purchase&&!!used&&purchase[0]===used[0];const quantityBase=valid?l.quantity*used[1]:null,packBase=l.pack_quantity*(purchase?.[1]||1);
  const price=valid?(l.manual_unit_cost_minor===null?Math.round(quantityBase/packBase*l.pack_cost_minor):Math.round(quantityBase*l.manual_unit_cost_minor)):null;
  return {...l,quantity_base:quantityBase,cost_minor:price===null?null:Math.round(price*(1+l.waste_percent/100)),cost_source:l.manual_unit_cost_minor===null?'purchasing':'manual'};
 });
 const complete=costed.length>0&&costed.every(l=>l.cost_minor!==null),base=complete?costed.reduce((sum,l)=>sum+l.cost_minor,0)+recipe.packaging_cost_minor:null;
 const total=base===null?null:Math.round(base*(1+recipe.waste_percent/100)),per=total===null?null:Math.round(total/recipe.yield_quantity);
 const links=db.prepare('SELECT p.id,p.name,p.price FROM recipe_menu_links l JOIN products p ON p.id=l.product_id WHERE l.recipe_id=?').all(recipe.id);
 const direct=links[0]?.price??recipe.direct_price_minor??recipe.target_price_minor,delivery=recipe.delivery_price_minor;
 const ratio=price=>per!==null&&price>0?Math.round((price-per)/price*10000)/100:null;
 let historical={};try{historical=JSON.parse(recipe.historical_metadata||'{}')}catch{}
 return {...recipe,lines:costed,menu_items:links,total_cost_minor:total,cost_per_serve_minor:per,cogs_percent:per!==null&&direct>0?Math.round(per/direct*10000)/100:null,direct_margin_percent:ratio(direct),delivery_margin_percent:ratio(delivery),suggested_price_minor:per===null?null:Math.ceil(per/0.3),historical,imported_cost_discrepancy_minor:historical.totalCost==null||total===null?null:total-Math.round(Number(historical.totalCost)*100)};
}
function validate(db,input,existing=null){
 const name=string(input.name,120);if(!name)fail(400,'Enter a recipe name.');
 const yieldQuantity=positive(input.yieldQuantity,'yield quantity'),waste=percent(input.wastePercent,'waste percentage');
 if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>150)fail(400,'Add at least one ingredient or packaging item.');
 const lines=input.lines.map((line,index)=>{const item=db.prepare('SELECT i.*,c.name AS category FROM food_ingredients i LEFT JOIN purchasing_categories c ON c.id=i.category_id WHERE i.id=?').get(line.itemId);if(!item)fail(400,'Line '+(index+1)+': choose a purchasing item.');
  if(!item.active&&!(existing?.id&&db.prepare('SELECT 1 FROM recipe_cost_lines WHERE recipe_id=? AND item_id=?').get(existing.id,item.id)))fail(400,'Line '+(index+1)+': this purchasing item is inactive.');
  const type=line.lineType==='packaging'?'packaging':line.lineType==='ingredient'?'ingredient':null;if(!type)fail(400,'Choose ingredient or packaging.');
  if(['Admin','Cleaning'].includes(item.category))fail(400,'Line '+(index+1)+': this category is not used for recipes.');
  const unit=line.unitUsed||item.base_unit;if(!units[unit]||units[unit][0]!==item.base_unit)fail(400,'Line '+(index+1)+': choose a matching measurement unit.');
  return {itemId:item.id,lineType:type,quantity:positive(line.quantity,'quantity'),unitUsed:unit,wastePercent:percent(line.wastePercent,'waste percentage'),manualUnitCostMinor:minor(line.manualUnitCostMinor,'manual unit cost'),notes:string(line.notes,500)};
 });
 const productIds=[...new Set(input.productIds||[])];for(const id of productIds)if(!db.prepare('SELECT id FROM products WHERE id=?').get(id))fail(400,'Choose an existing menu item.');
 return {name,yieldQuantity,yieldUnit:string(input.yieldUnit,60)||'portion',waste,packaging:minor(input.packagingCostMinor??0,'packaging allowance'),description:string(input.description,2000),category:string(input.category,120),imageUrl:string(input.imageUrl,500),status:string(input.status,30)||'Draft',active:input.active===false||input.active===0?0:1,instructions:string(input.instructions),notes:string(input.notes),target:minor(input.targetPriceMinor,'target price'),direct:minor(input.directPriceMinor,'direct price'),delivery:minor(input.deliveryPriceMinor,'delivery price'),suggested:minor(input.suggestedPriceMinor,'suggested price'),historical:input.historical||{},lines,productIds};
}
function save(db,user,input,existing){const row=validate(db,input,existing),id=existing?.id||randomUUID(),now=new Date().toISOString();
 const clash=db.prepare('SELECT id FROM food_recipes WHERE name=? COLLATE NOCASE AND id<>?').get(row.name,id);if(clash)fail(409,'A recipe with this name already exists.');
 for(const productId of row.productIds){const prior=db.prepare('SELECT recipe_id FROM recipe_menu_links WHERE product_id=? AND recipe_id<>?').get(productId,id);if(prior)fail(409,'A menu item is linked to another recipe.');}
 const old=existing?.historical_metadata;const historical=Object.keys(row.historical).length?JSON.stringify(row.historical):old||'{}';
 if(existing)db.prepare('UPDATE food_recipes SET name=?,yield_quantity=?,packaging_cost_minor=?,waste_percent=?,target_price_minor=?,product_id=?,instructions=?,updated_at=?,description=?,category=?,yield_unit=?,image_url=?,status=?,delivery_price_minor=?,direct_price_minor=?,suggested_price_minor=?,notes=?,historical_metadata=?,active=? WHERE id=?').run(row.name,row.yieldQuantity,row.packaging,row.waste,row.target,row.productIds[0]||null,row.instructions,now,row.description,row.category,row.yieldUnit,row.imageUrl,row.status,row.delivery,row.direct,row.suggested,row.notes,historical,row.active,id);
 else db.prepare('INSERT INTO food_recipes(id,name,yield_quantity,packaging_cost_minor,waste_percent,target_price_minor,product_id,instructions,updated_at,description,category,yield_unit,image_url,status,delivery_price_minor,direct_price_minor,suggested_price_minor,notes,historical_metadata,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,row.name,row.yieldQuantity,row.packaging,row.waste,row.target,row.productIds[0]||null,row.instructions,now,row.description,row.category,row.yieldUnit,row.imageUrl,row.status,row.delivery,row.direct,row.suggested,row.notes,historical,row.active);
 db.prepare('DELETE FROM recipe_cost_lines WHERE recipe_id=?').run(id);db.prepare('DELETE FROM food_recipe_components WHERE recipe_id=?').run(id);db.prepare('DELETE FROM recipe_menu_links WHERE recipe_id=?').run(id);
 const add=db.prepare('INSERT INTO recipe_cost_lines VALUES(?,?,?,?,?,?,?,?,?)'),legacy=db.prepare('INSERT OR IGNORE INTO food_recipe_components(recipe_id,ingredient_id,quantity) VALUES(?,?,?)');
 for(const l of row.lines){add.run(randomUUID(),id,l.itemId,l.lineType,l.quantity,l.unitUsed,l.wastePercent,l.manualUnitCostMinor,l.notes);if(l.lineType==='ingredient')legacy.run(id,l.itemId,l.quantity*units[l.unitUsed][1])}
 for(const productId of row.productIds)db.prepare('INSERT INTO recipe_menu_links VALUES(?,?)').run(id,productId);
 db.prepare('INSERT INTO food_model_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,'recipe',id,existing?'updated':'created',now);
 return costRecipe(db,db.prepare('SELECT * FROM food_recipes WHERE id=?').get(id));
}
export function handleRecipeCosting(url,method,res,db,user,body){
 const path=url.pathname.replace(/^\/(?:v5|v5-test)\/api(?=\/|$)/,'');if(!path.startsWith('/recipe-costing'))return false;
 try{
  if(user.permissions?!user.permissions.has('operations.recipes')||!user.permissions.has('operations.costing'):user.role!=='Owner')fail(403,'Recipe costing access is required.');
  if(user.tenantId&&process.env.PLATFORM_TENANT_ID&&user.tenantId!==process.env.PLATFORM_TENANT_ID)fail(403,'This restaurant is unavailable.');
  const p=path.slice('/recipe-costing'.length).split('/').filter(Boolean),b=body||{};
  if(method==='GET'&&p.length===0){send(res,200,{recipes:db.prepare('SELECT * FROM food_recipes ORDER BY name COLLATE NOCASE').all().map(r=>costRecipe(db,r))});return true}
  if(p[0]==='import'&&method==='POST'){
   if(!Array.isArray(b.records)||!b.records.length||b.records.length>100)fail(400,'Choose 1 to 100 recipes.');
   const seen=new Set(),proposals=b.records.map(r=>{const key=string(r.name,120).toLocaleLowerCase();if(seen.has(key))fail(409,'The upload contains a duplicate recipe name.');seen.add(key);
    const existing=db.prepare('SELECT * FROM food_recipes WHERE name=? COLLATE NOCASE').get(r.name);
    if(existing&&!r.id)fail(409,'A recipe already has this name. Choose it explicitly before updating.');
    if(r.id&&existing?.id!==r.id)fail(409,'The selected recipe does not match its name.');
    validate(db,r,existing);return {action:existing?'update':'create',id:existing?.id||null,name:r.name,updatedAt:existing?.updated_at||null};
   });
   if(b.confirm!==true){send(res,200,{proposals});return true}
   if(JSON.stringify(b.expected)!==JSON.stringify(proposals))fail(409,'Recipes changed since preview. Review the import again.');
   db.exec('BEGIN IMMEDIATE');try{const saved=b.records.map((r,i)=>save(db,user,r,proposals[i].id?db.prepare('SELECT * FROM food_recipes WHERE id=?').get(proposals[i].id):null));db.exec('COMMIT');send(res,200,{ok:true,created:saved.filter((_,i)=>proposals[i].action==='create').length,updated:saved.filter((_,i)=>proposals[i].action==='update').length,discrepancies:saved.map(r=>({name:r.name,importedCost:r.historical.totalCost,currentCostMinor:r.total_cost_minor,differenceMinor:r.imported_cost_discrepancy_minor}))});return true}catch(e){db.exec('ROLLBACK');throw e}
  }
  if(method==='POST'&&p.length===0){db.exec('BEGIN IMMEDIATE');try{const recipe=save(db,user,b,null);db.exec('COMMIT');send(res,201,{recipe});return true}catch(e){db.exec('ROLLBACK');throw e}}
  if(p.length===1){const existing=db.prepare('SELECT * FROM food_recipes WHERE id=?').get(p[0]);if(!existing)fail(404,'Recipe not found.');
   if(method==='GET'){send(res,200,{recipe:costRecipe(db,existing)});return true}
   if(method==='PATCH'){db.exec('BEGIN IMMEDIATE');try{const recipe=save(db,user,b,existing);db.exec('COMMIT');send(res,200,{recipe});return true}catch(e){db.exec('ROLLBACK');throw e}}
  }
  fail(405,'This action is unavailable.');
 }catch(e){send(res,e.status||500,{message:e.status?e.message:'Recipe costing could not be saved.'});return true}
}
