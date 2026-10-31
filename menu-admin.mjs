import {randomUUID} from 'node:crypto';
const out=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const idOk=s=>/^[0-9a-f-]{36}$/i.test(s||'');
const iconList=new Set(['','🍔','🍟','🥤','🍕','🍣','🍱','🍤','🍜','🥗','🥩','🍗','🌮','🥪','🍞','🍰','☕','🧋','🍹','🧁','🍦','🥐','🍎','🥡','🛍️','🍽️','🥘','🧀']);
const imageOk=s=>!s||/^\/(?:v5|v5-test)\/api\/images\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(s);
const text=(v,max)=>String(v??'').trim().slice(0,max);
export function migrateMenuAdmin(db){
 for(const [table,column,ddl] of [['categories','image',"TEXT NOT NULL DEFAULT ''"],['categories','icon',"TEXT NOT NULL DEFAULT ''"],['products','description',"TEXT NOT NULL DEFAULT ''"]]){
  const cols=db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);
  if(!cols.includes(column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+ddl);
 }
 db.exec("CREATE TABLE IF NOT EXISTS menu_archive_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL)");
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
