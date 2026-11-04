import {randomUUID} from 'node:crypto';
const out=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const idOk=s=>/^[0-9a-f-]{36}$/i.test(s||'');
const iconList=new Set(['','🍔','🍟','🥤','🍕','🍣','🍱','🍤','🍜','🥗','🥩','🍗','🌮','🥪','🍞','🍰','☕','🧋','🍹','🧁','🍦','🥐','🍎','🥡','🛍️','🍽️','🥘','🧀']);
const imageOk=s=>!s||/^\/(?:v5|v5-test)\/api\/images\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(s);
const text=(v,max)=>String(v??'').trim().slice(0,max);
export function migrateMenuAdmin(db){
 for(const [table,column,ddl] of [['categories','image',"TEXT NOT NULL DEFAULT ''"],['categories','icon',"TEXT NOT NULL DEFAULT ''"],['products','description',"TEXT NOT NULL DEFAULT ''"],['products','available','INTEGER NOT NULL DEFAULT 1']]){
  const cols=db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);
  if(!cols.includes(column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+ddl);
 }
 db.exec("CREATE TABLE IF NOT EXISTS menu_archive_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL)");
}
export function migrateProductPriceOptions(db){db.exec('CREATE TABLE IF NOT EXISTS product_price_option_groups(product_id TEXT PRIMARY KEY REFERENCES products(id),group_id TEXT UNIQUE NOT NULL REFERENCES modifier_groups(id))')}
export function handleProductConfiguration({db,p,method,b,user,res}){
 if(method==='GET'&&/^\/products\/[0-9a-f-]{36}\/configuration$/i.test(p)){
  const id=p.split('/')[2],group=db.prepare('SELECT group_id FROM product_price_option_groups WHERE product_id=?').get(id);
  if(!group){out(res,200,{priceOptions:[]});return true}
  const base=db.prepare('SELECT price FROM products WHERE id=?').get(id)?.price||0;
  out(res,200,{priceOptions:db.prepare('SELECT name,price_minor FROM modifier_options WHERE group_id=? AND active=1 ORDER BY sort_order').all(group.group_id).map(x=>({name:x.name,priceMinor:base+x.price_minor}))});return true;
 }

 const match=p.match(/^\/products\/([0-9a-f-]{36})\/configuration$/i);
 if(!match)return false;
 if(method!=='POST'){out(res,405,{message:'Use Save to update this product.'});return true;}
 if(!['Owner','Manager'].includes(user.role)){out(res,403,{message:'Manager or Owner access is required.'});return true;}
 try{
  const id=match[1],old=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
  if(!old)fail(404,'This menu item is no longer available. Refresh the menu.');
  const name=text(b?.name,120),category=text(b?.category,80),description=text(b?.description,1000),image=text(b?.image,1000);
  const price=Math.round(Number(b?.price)*100);const available=b?.available===undefined?old.available:(b.available?1:0);
  if(!name||!db.prepare('SELECT id FROM categories WHERE name=? AND active=1').get(category)||!Number.isSafeInteger(price)||price<0||!imageOk(image))fail(400,'Enter a valid name, category, base price and uploaded image.');
  const groups=b?.groupIds,entries=b?.channelPrices;
  if(!Array.isArray(groups)||groups.length>30||new Set(groups).size!==groups.length)fail(400,'Choose valid, distinct modifier groups.');
  for(const gid of groups)if(!db.prepare('SELECT id FROM modifier_groups WHERE id=? AND active=1').get(gid))fail(400,'One of your modifier groups is no longer available.');
  if(!Array.isArray(entries)||entries.length>50||new Set(entries.map(e=>e.channelId)).size!==entries.length)fail(400,'Choose distinct sales channels.');
  for(const e of entries){
   if(!e||typeof e.channelId!=='string'||!Number.isSafeInteger(e.priceMinor)||e.priceMinor<0||e.priceMinor>100000000||!db.prepare('SELECT id FROM sales_channels WHERE id=? AND active=1 AND is_default=0').get(e.channelId))fail(400,'A delivery price or channel is invalid.');
  }
  if(entries.length&&user.role!=='Owner')fail(403,'Only the Owner can change delivery partner prices.');
  if(b.recipeId!==undefined&&user.role!=='Owner')fail(403,'Only the Owner can link costing recipes.');
  const priceOptions=b.priceOptions;
  if(priceOptions!==undefined){
   if(!Array.isArray(priceOptions)||priceOptions.length>24)fail(400,'Add no more than 24 price options.');
   const seen=new Set();
   for(const opt of priceOptions){
    const label=text(opt?.name,80);
    if(!label||seen.has(label.toLowerCase())||!Number.isSafeInteger(opt.priceMinor)||opt.priceMinor<price||opt.priceMinor>100000000)fail(400,'Each price option needs a unique name and a price at least as high as the base price.');
    seen.add(label.toLowerCase());
   }
  }
  const recipeId=b.recipeId;
  if(recipeId&&(!idOk(recipeId)||!db.prepare('SELECT id FROM food_recipes WHERE id=?').get(recipeId)))fail(400,'Select a valid recipe.');
  if(recipeId){const linked=db.prepare('SELECT product_id FROM food_recipes WHERE id=?').get(recipeId)?.product_id;if(linked&&linked!==id)fail(409,'That recipe is linked to another item.');}
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE products SET name=?,category=?,price=?,image=?,description=?,available=? WHERE id=?').run(name,category,price,image,description,available,id);
   const now=new Date().toISOString();
   db.prepare('INSERT INTO channel_prices(channel_id,product_id,price_minor,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel_id,product_id) DO UPDATE SET price_minor=excluded.price_minor,updated_at=excluded.updated_at').run('in-store',id,price,now);
   const current=db.prepare('SELECT channel_id FROM channel_prices WHERE product_id=? AND channel_id<>?').all(id,'in-store');
   for(const c of current)if(!entries.some(e=>e.channelId===c.channel_id))db.prepare('DELETE FROM channel_prices WHERE product_id=? AND channel_id=?').run(id,c.channel_id);
   for(const e of entries)db.prepare('INSERT INTO channel_prices(channel_id,product_id,price_minor,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel_id,product_id) DO UPDATE SET price_minor=excluded.price_minor,updated_at=excluded.updated_at').run(e.channelId,id,e.priceMinor,now);
   db.prepare('DELETE FROM product_modifier_groups WHERE product_id=?').run(id);
   for(const gid of groups)db.prepare('INSERT INTO product_modifier_groups(product_id,group_id) VALUES(?,?)').run(id,gid);
   if(priceOptions!==undefined){
    const existing=db.prepare('SELECT group_id FROM product_price_option_groups WHERE product_id=?').get(id);
    let gid=existing?.group_id;
    if(priceOptions.length){
     if(!gid){gid=randomUUID();db.prepare('INSERT INTO modifier_groups(id,name,min_select,max_select,active,sort_order) VALUES(?,?,1,1,1,0)').run(gid,'Item options · '+id);db.prepare('INSERT INTO product_price_option_groups(product_id,group_id) VALUES(?,?)').run(id,gid);}
     db.prepare('UPDATE modifier_groups SET min_select=1,max_select=1,active=1 WHERE id=?').run(gid);
     db.prepare('DELETE FROM modifier_options WHERE group_id=?').run(gid);
     for(const [index,opt] of priceOptions.entries())db.prepare('INSERT INTO modifier_options(id,group_id,name,price_minor,sort_order) VALUES(?,?,?,?,?)').run(randomUUID(),gid,text(opt.name,80),opt.priceMinor-price,index);
     db.prepare('INSERT OR IGNORE INTO product_modifier_groups(product_id,group_id) VALUES(?,?)').run(id,gid);
    }else if(gid){db.prepare('DELETE FROM product_modifier_groups WHERE product_id=? AND group_id=?').run(id,gid);db.prepare('UPDATE modifier_groups SET active=0 WHERE id=?').run(gid);}
   }
   if(recipeId!==undefined){db.prepare('UPDATE food_recipes SET product_id=NULL,updated_at=? WHERE product_id=?').run(now,id);if(recipeId)db.prepare('UPDATE food_recipes SET product_id=?,updated_at=? WHERE id=?').run(id,now,recipeId);}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  out(res,200,{ok:true,id});return true;
 }catch(e){out(res,e.status||500,{message:e.status?e.message:'Could not save this menu item. No changes were applied.'});return true}
}
export function handleMenuAdmin({db,p,method,b,user,res,seedProductPrices}){
 if(!/^(\/products|\/categories)(\/|$)/.test(p))return false;
 if(p.split('/').filter(Boolean).length>2)return false; // Preserve nested routes such as /products/:id/modifier-groups.
 if(method==='GET')return false;
 if(!['Owner','Manager'].includes(user.role)){out(res,403,{message:'Manager or Owner access is required.'});return true;}
 try{
  const category=p.startsWith('/categories'),root=category?'/categories':'/products';
  const id=p.slice(root.length+1);
  if(method!=='POST'&&method!=='PATCH'&&method!=='DELETE')return false;
  if(method==='POST'&&p!==root)fail(404,'Not found.');
  if(method!=='POST'&&!idOk(id))fail(400,'Choose an existing record.');
  const old=method==='POST'?null:db.prepare('SELECT * FROM '+(category?'categories':'products')+' WHERE id=? AND active=1').get(id);
  if(method!=='POST'&&!old)fail(404,'Record not found or already retired.');
  if(category){
   if(method==='DELETE'||(method==='PATCH'&&b?.active===false)){
    if(db.prepare('SELECT COUNT(*) n FROM products WHERE category=? AND active=1').get(old.name).n)fail(409,'Move or retire all menu items in this category first.');
    db.exec('BEGIN IMMEDIATE');
    try{
     db.prepare('UPDATE categories SET active=0 WHERE id=?').run(id);
     db.prepare('INSERT INTO menu_archive_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,'category',id,'retired',new Date().toISOString());
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    out(res,200,{ok:true,archived:true});return true;
   }
   const name=text(b?.name??old?.name,80),icon=text(b?.icon??old?.icon,10),image=text(b?.image??old?.image,1000);
   if(!name||!iconList.has(icon)||!imageOk(image))fail(400,'Choose a category name, supported icon and uploaded image.');
   const collision=db.prepare('SELECT id FROM categories WHERE name=? AND id<>?').get(name,id||'');
   if(collision)fail(409,'A category with this name already exists, including retired categories.');
   db.exec('BEGIN IMMEDIATE');
   try{
    if(method==='POST')db.prepare('INSERT INTO categories(id,name,sort_order,image,icon) VALUES(?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM categories),?,?)').run(randomUUID(),name,image,icon);
    else{
     const sort=Number(b?.sortOrder??old.sort_order);
     if(!Number.isSafeInteger(sort)||sort<0)fail(400,'Invalid category position.');
     db.prepare('UPDATE categories SET name=?,sort_order=?,image=?,icon=? WHERE id=?').run(name,sort,image,icon,id);
     if(name!==old.name)db.prepare('UPDATE products SET category=? WHERE category=?').run(name,old.name);
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   out(res,method==='POST'?201:200,{ok:true});return true;
  }
  if(method==='DELETE'||(method==='PATCH'&&b?.active===false)){
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('UPDATE products SET active=0 WHERE id=?').run(id);
    db.prepare('INSERT INTO menu_archive_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,'product',id,'retired',new Date().toISOString());
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   out(res,200,{ok:true,archived:true});return true;
  }
  const name=text(b?.name??old?.name,120),cat=text(b?.category??old?.category,80),desc=text(b?.description??old?.description,1000),image=text(b?.image??old?.image,1000);
  const price=b?.price===undefined?old?.price:Math.round(Number(b.price)*100);
  if(!name||!db.prepare('SELECT id FROM categories WHERE name=? AND active=1').get(cat)||!Number.isSafeInteger(price)||price<0||!imageOk(image))fail(400,'Choose a valid name, category, price and uploaded image.');
  if(b?.recipeId!==undefined&&user.role!=='Owner')fail(403,'Only the Owner can assign costing recipes.');
  const recipeId=b?.recipeId;
  if(recipeId && !idOk(recipeId))fail(400,'Select an existing recipe.');
  if(recipeId){
   if(!db.prepare('SELECT id FROM food_recipes WHERE id=?').get(recipeId))fail(404,'Recipe not found.');
   const linked=db.prepare('SELECT product_id FROM food_recipes WHERE id=?').get(recipeId)?.product_id;
   if(linked&&linked!==id)fail(409,'That recipe is already assigned to another item.');
  }
  const productId=method==='POST'?randomUUID():id;
  db.exec('BEGIN IMMEDIATE');
  try{
   if(method==='POST')db.prepare('INSERT INTO products(id,name,category,price,image,description) VALUES(?,?,?,?,?,?)').run(productId,name,cat,price,image,desc);
   else db.prepare('UPDATE products SET name=?,category=?,price=?,image=?,description=? WHERE id=?').run(name,cat,price,image,desc,id);
   if(recipeId!==undefined){
    db.prepare('UPDATE food_recipes SET product_id=NULL,updated_at=? WHERE product_id=?').run(new Date().toISOString(),productId);
    if(recipeId)db.prepare('UPDATE food_recipes SET product_id=?,updated_at=? WHERE id=?').run(productId,new Date().toISOString(),recipeId);
   }
   seedProductPrices(db,productId,price);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  out(res,method==='POST'?201:200,{ok:true,id:productId});return true;
 }catch(e){out(res,e.status||500,{message:e.status?e.message:'Menu update failed.'});return true;}
}
