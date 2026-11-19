import assert from 'node:assert/strict';import {test} from 'node:test';import {DatabaseSync} from 'node:sqlite';
import {migrateFoodModel,handleFoodModel} from '../food-model.mjs';import {migratePurchasing} from '../purchasing.mjs';import {migrateRecipeCosting,handleRecipeCosting} from '../recipe-costing.mjs';
import {migrateSaleCosts,snapshotSaleCost} from '../sales-costs.mjs';
function db(){const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON;CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,active INTEGER,price INTEGER);');migrateFoodModel(d);migratePurchasing(d);migrateRecipeCosting(d);return d}
const owner={id:'owner',role:'Owner',permissions:new Set(['operations.recipes','operations.costing'])};
function call(d,path,method='GET',body={},user=owner){const res={writeHead(status){this.status=status},end(s){this.data=JSON.parse(s)}};handleRecipeCosting(new URL('http://localhost/v5/api/recipe-costing'+path),method,res,d,user,body);return res}
test('purchasing costs and multiple menu links recalculate, existing sales snapshots stay immutable',()=>{
 const d=db();d.exec("INSERT INTO products(id,name,active,price) VALUES('one','Single',1,17000),('two','Set',1,25000);CREATE TABLE order_items(id TEXT PRIMARY KEY);CREATE TABLE order_item_cost_snapshots(order_item_id TEXT PRIMARY KEY,per_item_cost_minor INTEGER)");
 d.exec("INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,updated_at) VALUES('beef','Beef','g',1,'kg',30000,'2026-11-19'),('box','Box','each',100,'each',10000,'2026-11-19')");
 const body={name:'Burger',yieldQuantity:1,yieldUnit:'burger',productIds:['one','two'],targetPriceMinor:19000,lines:[{itemId:'beef',quantity:90,unitUsed:'g',lineType:'ingredient',wastePercent:5},{itemId:'box',quantity:1,unitUsed:'each',lineType:'packaging'}]};
 const saved=call(d,'','POST',body);assert.equal(saved.status,201);const id=saved.data.recipe.id;assert.equal(saved.data.recipe.menu_items.length,2);assert.equal(saved.data.recipe.cost_per_serve_minor,2935);
 d.exec("INSERT INTO order_items(id) VALUES('old');INSERT INTO order_item_cost_snapshots VALUES('old',2935)");d.exec("UPDATE food_ingredients SET pack_cost_minor=40000 WHERE id='beef'");
 assert.equal(call(d,'/'+id).data.recipe.cost_per_serve_minor,3880);assert.equal(d.prepare("SELECT per_item_cost_minor FROM order_item_cost_snapshots WHERE order_item_id='old'").get().per_item_cost_minor,2935);
 assert.equal(call(d,'/'+id,'PATCH',{...body,lines:[{...body.lines[0],unitUsed:'ml'}]}).status,400);
 assert.equal(call(d,'','GET',{}, {id:'staff',role:'Cashier'}).status,403);
  assert.equal(call(d,'','GET',{}, {id:'manager',role:'Manager',permissions:new Set(['operations.recipes','operations.costing'])}).status,200);
});
test('nested import is atomic and retains historical values separately',()=>{
 const d=db();d.exec("INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,updated_at) VALUES('bun','Bun','each',12,'each',12000,'2026-11-19')");
 const row={name:'Meal',yieldQuantity:1,lines:[{itemId:'bun',lineType:'ingredient',quantity:1,unitUsed:'each'}],historical:{id:'73',totalCost:'9.99',version:'4',createdAt:'2025-01-01'}};
 const proposed=call(d,'/import','POST',{records:[row]});assert.equal(proposed.status,200);assert.equal(call(d,'').data.recipes.length,0);
 const bad=call(d,'/import','POST',{records:[row],confirm:true,expected:[]});assert.equal(bad.status,409);
 const result=call(d,'/import','POST',{records:[row],confirm:true,expected:proposed.data.proposals});assert.equal(result.status,200);assert.equal(result.data.discrepancies[0].differenceMinor,1);
 assert.equal(call(d,'').data.recipes[0].historical.id,'73');assert.notEqual(call(d,'').data.recipes[0].id,'73');
});
test('checkout snapshots use purchasing and packaging cost for every linked menu item',()=>{
 const d=db();d.exec("CREATE TABLE order_items(id TEXT PRIMARY KEY);CREATE TABLE modifier_options(id TEXT PRIMARY KEY);CREATE TABLE order_item_modifiers(order_item_id TEXT,option_id TEXT,option_name TEXT,quantity INTEGER);INSERT INTO products VALUES('set','Set',1,22000);INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,updated_at) VALUES('beef','Beef','g',1,'kg',30000,'2026-11-19'),('box','Box','each',100,'each',10000,'2026-11-19')");
 migrateSaleCosts(d);
 assert.equal(call(d,'','POST',{name:'Set recipe',yieldQuantity:1,productIds:['set'],lines:[{itemId:'beef',lineType:'ingredient',quantity:90,unitUsed:'g'},{itemId:'box',lineType:'packaging',quantity:1,unitUsed:'each'}]}).status,201);
 d.exec("INSERT INTO order_items VALUES('sale-1'),('sale-2')");snapshotSaleCost(d,'sale-1','set',1);
 assert.equal(d.prepare("SELECT per_item_cost_minor FROM order_item_cost_snapshots WHERE order_item_id='sale-1'").get().per_item_cost_minor,2800);
 d.exec("UPDATE food_ingredients SET pack_cost_minor=40000 WHERE id='beef'");snapshotSaleCost(d,'sale-2','set',1);
 const costs=d.prepare('SELECT per_item_cost_minor FROM order_item_cost_snapshots ORDER BY order_item_id').all().map(x=>x.per_item_cost_minor);
 assert.deepEqual(costs,[2800,3700]);
});
test('a case of bottles costs accurately by bottle or volume without changing pack details',()=>{
 const d=db();d.exec("INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,each_quantity,each_unit,units_per_pack,updated_at) VALUES('water','Water case','ml',12,'each',14400,600,'ml',12,'2026-11-19')");
 const saved=call(d,'','POST',{name:'Drink set',yieldQuantity:1,lines:[{itemId:'water',lineType:'ingredient',quantity:1,unitUsed:'each'}]});assert.equal(saved.status,201);assert.equal(saved.data.recipe.total_cost_minor,1200);
 const updated=call(d,'/'+saved.data.recipe.id,'PATCH',{name:'Drink set',yieldQuantity:1,lines:[{itemId:'water',lineType:'ingredient',quantity:300,unitUsed:'ml'}]});assert.equal(updated.status,200);assert.equal(updated.data.recipe.total_cost_minor,600);
 const pack=d.prepare("SELECT pack_quantity,units_per_pack,each_quantity,each_unit FROM food_ingredients WHERE id='water'").get();assert.deepEqual({...pack},{pack_quantity:12,units_per_pack:12,each_quantity:600,each_unit:'ml'});
});
test('legacy recipe relinking synchronizes current checkout associations',()=>{
 const d=db();d.exec("INSERT INTO products VALUES('old','Old item',1,10000),('new','New item',1,10000);INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,updated_at) VALUES('bun','Bun','each',10,'each',10000,'2026-11-19')");
 const request=(path,method,body)=>{const res={writeHead(status){this.status=status},end(payload){this.data=JSON.parse(payload)}};handleFoodModel(new URL('http://localhost/v5/api/food-model'+path),method,res,d,owner,body);return res};
 const original=request('/recipes','POST',{name:'Bun recipe',yieldQuantity:1,productId:'old',components:[{ingredientId:'bun',quantity:1}]});assert.equal(original.status,200);
 const recipeId=original.data.recipe.id;
 const changed=request('/recipes/'+recipeId,'PATCH',{name:'Bun recipe',yieldQuantity:1,productId:'new',components:[{ingredientId:'bun',quantity:1}]});assert.equal(changed.status,200);
 assert.deepEqual(d.prepare('SELECT product_id FROM recipe_menu_links WHERE recipe_id=?').all(recipeId).map(x=>x.product_id),['new']);
 assert.equal(request('/recipes/'+recipeId,'PATCH',{name:'Bun recipe',yieldQuantity:1,productId:null,components:[{ingredientId:'bun',quantity:1}]}).status,200);
 assert.equal(d.prepare('SELECT count(*) AS n FROM recipe_menu_links WHERE recipe_id=?').get(recipeId).n,0);
});
