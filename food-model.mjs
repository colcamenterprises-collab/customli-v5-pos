import {randomUUID} from 'node:crypto';
// Adapted from the V3 recipe/yield/packaging/waste model; V5 data stays isolated.
const out=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const units={g:{base:'g',multiplier:1},kg:{base:'g',multiplier:1000},ml:{base:'ml',multiplier:1},L:{base:'ml',multiplier:1000},each:{base:'each',multiplier:1}};
const integer=(n,min,max,label)=>{if(!Number.isSafeInteger(n)||n<min||n>max)fail(400,'Enter a valid '+label+'.');return n;};
const quantity=(n,label)=>{const v=Number(n);if(!Number.isFinite(v)||v<=0||v>1000000)fail(400,'Enter a valid '+label+'.');return v;};
const label=(s,name)=>{const v=String(s||'').trim();if(!v||v.length>120)fail(400,'Enter a valid '+name+'.');return v;};
const lookup=(db,id)=>db.prepare('SELECT * FROM food_recipes WHERE id=?').get(id);
export function migrateFoodModel(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS food_ingredients(
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,base_unit TEXT NOT NULL CHECK(base_unit IN ('g','ml','each')),pack_quantity REAL NOT NULL CHECK(pack_quantity>0),pack_unit TEXT NOT NULL CHECK(pack_unit IN ('g','kg','ml','L','each')),pack_cost_minor INTEGER NOT NULL CHECK(pack_cost_minor>=0),updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS food_recipes(
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,yield_quantity REAL NOT NULL CHECK(yield_quantity>0),packaging_cost_minor INTEGER NOT NULL DEFAULT 0,waste_percent REAL NOT NULL DEFAULT 0 CHECK(waste_percent>=0 AND waste_percent<=100),target_price_minor INTEGER,product_id TEXT UNIQUE REFERENCES products(id),instructions TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS food_recipe_components(
 recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,ingredient_id TEXT NOT NULL REFERENCES food_ingredients(id),quantity REAL NOT NULL CHECK(quantity>0),PRIMARY KEY(recipe_id,ingredient_id)
 );
 CREATE TABLE IF NOT EXISTS food_model_audit(
 id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL
 );
 `);
}
const costed=(db,recipe)=>{
 const lines=db.prepare('SELECT c.ingredient_id,i.name,i.base_unit,i.pack_unit,i.pack_quantity,i.pack_cost_minor,c.quantity FROM food_recipe_components c JOIN food_ingredients i ON i.id=c.ingredient_id WHERE c.recipe_id=? ORDER BY i.name COLLATE NOCASE').all(recipe.id);
 const components=lines.map(l=>{const packBase=l.pack_quantity*units[l.pack_unit].multiplier;const costMinor=Math.round(l.quantity/packBase*l.pack_cost_minor);return {...l,cost_minor:costMinor,pack_base_quantity:packBase};});
 const calculated=components.length>0;
 const base=calculated?components.reduce((s,l)=>s+l.cost_minor,0)+recipe.packaging_cost_minor:null;
 const batch=calculated?Math.round(base*(1+recipe.waste_percent/100)):null;
 const perServe=calculated?Math.round(batch/recipe.yield_quantity):null;
 const current=db.prepare('SELECT id,name,price FROM products WHERE id=? AND active=1').get(recipe.product_id)||null;
 const sell=current?.price??recipe.target_price_minor??null;
 const margin=perServe!==null&&sell>0?Math.round((sell-perServe)/sell*10000)/100:null;
 return {...recipe,product:current,components,total_cost_minor:batch,cost_per_serve_minor:perServe,selling_price_minor:sell,estimated_gross_profit_minor:perServe!==null&&sell!==null?sell-perServe:null,estimated_food_cost_percent:perServe!==null&&sell>0?Math.round(perServe/sell*10000)/100:null,estimated_gross_margin_percent:margin,cost_status:calculated?'calculated':'incomplete'};
};
const audit=(db,user,entityType,id,action)=>db.prepare('INSERT INTO food_model_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,entityType,id,action,new Date().toISOString());
export function handleFoodModel(url,method,res,db,user,body){
 const path=url.pathname.replace(/^\/(?:v5|v5-test)\/api(?=\/|$)/,'');
 if(!path.startsWith('/food-model'))return false;
 if(user.role!=='Owner'){out(res,403,{message:'Owner access is required to manage food costs.'});return true;}
 try{
 const p=path.slice('/food-model'.length).split('/').filter(Boolean);
 if(method==='GET'&&p.join('/')==='ingredients'){
  out(res,200,{ingredients:db.prepare('SELECT * FROM food_ingredients ORDER BY name COLLATE NOCASE').all()});return true;
 }
 if(method==='GET'&&p.join('/')==='recipes'){
  out(res,200,{recipes:db.prepare('SELECT * FROM food_recipes ORDER BY name COLLATE NOCASE').all().map(r=>costed(db,r))});return true;
 }
 if(method==='GET'&&p[0]==='recipes'&&p[1]){
  const recipe=lookup(db,p[1]);if(!recipe)fail(404,'Recipe not found.');
  out(res,200,{recipe:costed(db,recipe)});return true;
 }
 if(method==='GET'&&p.join('/')==='modifier-costs'){
  const rows=db.prepare('SELECT m.option_id,m.ingredient_id,m.quantity,i.name AS ingredient_name,o.name AS option_name FROM food_modifier_ingredients m JOIN food_ingredients i ON i.id=m.ingredient_id JOIN modifier_options o ON o.id=m.option_id ORDER BY o.name,i.name').all();
  out(res,200,{mappings:rows});return true;
 }
 if(method==='POST'&&p.join('/')==='modifier-costs'){
  const optionId=String(body?.optionId||''),ingredientId=String(body?.ingredientId||''),amount=Number(body?.quantity);
  if(!db.prepare('SELECT id FROM modifier_options WHERE id=?').get(optionId))fail(404,'Modifier option not found.');
  if(!db.prepare('SELECT id FROM food_ingredients WHERE id=?').get(ingredientId))fail(404,'Ingredient not found.');
  if(!Number.isFinite(amount)||!amount||Math.abs(amount)>100000)fail(400,'Enter a non-zero ingredient quantity.');
  db.prepare('INSERT INTO food_modifier_ingredients(option_id,ingredient_id,quantity) VALUES(?,?,?) ON CONFLICT(option_id,ingredient_id) DO UPDATE SET quantity=excluded.quantity').run(optionId,ingredientId,amount);
  audit(db,user,'modifier_option',optionId,'ingredient_cost_mapping_updated');out(res,200,{ok:true});return true;
 }
 if(method==='DELETE'&&p[0]==='modifier-costs'&&p.length===3){
  db.prepare('DELETE FROM food_modifier_ingredients WHERE option_id=? AND ingredient_id=?').run(p[1],p[2]);
  audit(db,user,'modifier_option',p[1],'ingredient_cost_mapping_removed');out(res,200,{ok:true});return true;
 }
 if(method==='GET'&&p.join('/')==='menu-costing'){
  const recipes=db.prepare('SELECT * FROM food_recipes WHERE product_id IS NOT NULL').all().map(r=>costed(db,r));
  out(res,200,{linked_recipes:recipes});return true;
 }
 if(method==='POST'&&p[0]==='recipes'&&p[2]==='publish'){
  const draft=lookup(db,p[1]);if(!draft)fail(404,'Recipe not found.');
  if(draft.product_id)fail(409,'This recipe is already linked to a POS menu item.');
  const costing=costed(db,draft);
  if(costing.cost_per_serve_minor==null)fail(409,'Complete the ingredient costs before publishing a menu item.');
  const record=body||{},name=label(record.name,'menu item name'),category=label(record.category,'category');
  const price=integer(record.priceMinor,1,1000000000,'selling price');
  if(!db.prepare('SELECT id FROM categories WHERE name=? AND active=1').get(category))fail(400,'Select an existing active menu category.');
  if(db.prepare('SELECT id FROM products WHERE name=? COLLATE NOCASE AND active=1').get(name))fail(409,'An active menu item with this name already exists.');
  const productId=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT INTO products(id,name,category,price,active) VALUES(?,?,?,?,1)').run(productId,name,category,price);
    db.prepare('UPDATE food_recipes SET product_id=?,updated_at=? WHERE id=?').run(productId,new Date().toISOString(),draft.id);
    audit(db,user,'recipe',draft.id,'published_to_pos');
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  out(res,201,{product_id:productId,recipe:costed(db,lookup(db,draft.id))});return true;
 }
 if(!['POST','PATCH'].includes(method)||!['ingredients','recipes'].includes(p[0]))fail(405,'This action is not supported.');
 const record=body||{};
 if(p[0]==='ingredients'){
  const name=label(record.name,'ingredient name'),packUnit=String(record.packUnit||''),unit=units[packUnit];if(!unit)fail(400,'Choose g, kg, ml, L or each.');
  const packQuantity=quantity(record.packQuantity,'pack quantity'),packCost=integer(record.packCostMinor,0,1000000000,'pack cost');
  const id=method==='PATCH'?p[1]:randomUUID();
  if(method==='PATCH'&&!db.prepare('SELECT id FROM food_ingredients WHERE id=?').get(id))fail(404,'Ingredient not found.');
  const other=db.prepare('SELECT id FROM food_ingredients WHERE name=? COLLATE NOCASE AND id<>?').get(name,id);
  if(other)fail(409,'An ingredient with that name already exists.');
  // A unit-family change must never silently reinterpret existing recipe quantities.
  const existing=method==='PATCH'?db.prepare('SELECT base_unit FROM food_ingredients WHERE id=?').get(id):null;
  if(existing?.base_unit!==unit.base&&existing&&db.prepare('SELECT 1 FROM food_recipe_components WHERE ingredient_id=? LIMIT 1').get(id))fail(409,'Remove this ingredient from its recipes before changing its measurement unit.');
  const now=new Date().toISOString();
  if(method==='PATCH')db.prepare('UPDATE food_ingredients SET name=?,base_unit=?,pack_quantity=?,pack_unit=?,pack_cost_minor=?,updated_at=? WHERE id=?').run(name,unit.base,packQuantity,packUnit,packCost,now,id);
  else db.prepare('INSERT INTO food_ingredients VALUES(?,?,?,?,?,?,?)').run(id,name,unit.base,packQuantity,packUnit,packCost,now);
  audit(db,user,'ingredient',id,method==='PATCH'?'updated':'created');out(res,200,{ingredient:db.prepare('SELECT * FROM food_ingredients WHERE id=?').get(id)});return true;
 }
 const name=label(record.name,'recipe name'),yieldQ=quantity(record.yieldQuantity,'recipe yield'),packaging=integer(record.packagingCostMinor||0,0,1000000000,'packaging cost'),waste=Number(record.wastePercent??0);
 if(!Number.isFinite(waste)||waste<0||waste>100)fail(400,'Waste must be between 0 and 100 percent.');
 const target=record.targetPriceMinor==null?null:integer(record.targetPriceMinor,0,1000000000,'selling price');
 const product=record.productId||null;
 if(product&&!db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(product))fail(400,'Choose an existing menu item.');
 const lines=record.components;
 if(!Array.isArray(lines)||lines.length===0||lines.length>100)fail(400,'Add at least one ingredient to the recipe.');
 const ids=new Set(),resolved=[];
 for(const line of lines){
  const ingredient=db.prepare('SELECT id FROM food_ingredients WHERE id=?').get(String(line.ingredientId||''));
  if(!ingredient)fail(400,'An ingredient could not be found.');
  if(ids.has(ingredient.id))fail(400,'Each ingredient may appear once.');
  ids.add(ingredient.id);resolved.push([ingredient.id,quantity(line.quantity,'ingredient quantity')]);
 }
 const id=method==='PATCH'?p[1]:randomUUID();if(method==='PATCH'&&!lookup(db,id))fail(404,'Recipe not found.');
 const conflicting=product?db.prepare('SELECT id FROM food_recipes WHERE product_id=? AND id<>?').get(product,id):null;
 if(conflicting)fail(409,'That menu item is already linked to another recipe.');
 db.exec('BEGIN IMMEDIATE');
 try{
 const now=new Date().toISOString(),instructions=String(record.instructions||'').trim().slice(0,5000);
 if(method==='PATCH')db.prepare('UPDATE food_recipes SET name=?,yield_quantity=?,packaging_cost_minor=?,waste_percent=?,target_price_minor=?,product_id=?,instructions=?,updated_at=? WHERE id=?').run(name,yieldQ,packaging,waste,target,product,instructions,now,id);
 else db.prepare('INSERT INTO food_recipes VALUES(?,?,?,?,?,?,?,?,?)').run(id,name,yieldQ,packaging,waste,target,product,instructions,now);
 db.prepare('DELETE FROM food_recipe_components WHERE recipe_id=?').run(id);
 const ins=db.prepare('INSERT INTO food_recipe_components VALUES(?,?,?)');
 for(const [ingredientId,amount] of resolved)ins.run(id,ingredientId,amount);
 audit(db,user,'recipe',id,method==='PATCH'?'updated':'created');
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 out(res,200,{recipe:costed(db,lookup(db,id))});return true;
 }catch(e){out(res,e.status||500,{message:e.status?e.message:'Food costing could not be saved.'});return true;}
}
