import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {migrateFoodModel,handleFoodModel} from '../food-model.mjs';
import {migratePurchasing,handlePurchasing} from '../purchasing.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,active INTEGER,price INTEGER); CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT,active INTEGER);');
 migrateFoodModel(db);migratePurchasing(db);return db;
}
const owner={id:'owner',role:'Owner',permissions:new Set(['operations.purchasing','operations.costing'])};
function call(db,path,method='GET',body={},user=owner){
 const res={status:null,headers:null,body:'',writeHead(s,h){this.status=s;this.headers=h},end(s){this.body=s||''}};
 handlePurchasing(new URL('http://localhost/v5/api/purchasing'+path),method,res,db,user,body);
 return {...res,data:res.headers?.['Content-Type']?.startsWith('application/json')?JSON.parse(res.body):res.body};
}
function food(db,path,method='GET',body={}){
 const res={writeHead(s){this.status=s},end(s){this.data=JSON.parse(s)}};
 handleFoodModel(new URL('http://localhost/v5/api/food-model'+path),method,res,db,owner,body);return res;
}
test('migration preserves legacy ingredient IDs and costs',()=>{
 const db=fixture(),legacy=food(db,'/ingredients','POST',{name:'Beef',packQuantity:1,packUnit:'kg',packCostMinor:30000}).data.ingredient;
 migratePurchasing(db);
 assert.equal(call(db,'/items').data.items[0].id,legacy.id);
 assert.equal(call(db,'/items/'+legacy.id,'PATCH',{pack_cost_minor:999,purchaseCostMinor:40000}).data.item.pack_cost_minor,40000);
 assert.equal(call(db,'/items/'+legacy.id+'/history').data.history[0].change_minor,10000);
});
test('migration allows equivalent names across suppliers without changing recipe IDs',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,active INTEGER,price INTEGER)');migrateFoodModel(db);
 db.exec("INSERT INTO food_ingredients(id,name,base_unit,pack_quantity,pack_unit,pack_cost_minor,updated_at) VALUES('legacy','Bun','each',12,'each',12000,'2026-11-19');INSERT INTO food_recipes(id,name,yield_quantity,packaging_cost_minor,waste_percent,instructions,updated_at) VALUES('recipe','Single',1,0,0,'','2026-11-19');INSERT INTO food_recipe_components VALUES('recipe','legacy',1)");
 migratePurchasing(db);
 const a=call(db,'/suppliers','POST',{name:'Supplier A'}).data.record,b=call(db,'/suppliers','POST',{name:'Supplier B'}).data.record;
 assert.equal(call(db,'/items/legacy','PATCH',{supplierId:a.id}).status,200);
 assert.equal(call(db,'/items','POST',{name:'Bun',supplierId:b.id,packQuantity:12,packUnit:'each',purchaseCost:130}).status,201);
 assert.equal(db.prepare("SELECT ingredient_id FROM food_recipe_components WHERE recipe_id='recipe'").get().ingredient_id,'legacy');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('supplier, category, search data, price history and safe deletion',()=>{
 const db=fixture();const s=call(db,'/suppliers','POST',{name:'Makro',website:'https://makro.pro'}).data.record;
 const c=call(db,'/categories').data.categories.find(x=>x.name==='Fresh Food');
 const item=call(db,'/items','POST',{name:'Burger Beef',brand:'Local',supplierId:s.id,supplierSku:'BB-90',categoryId:c.id,packQuantity:1,packUnit:'kg',purchaseCost:300,currency:'THB'}).data.item;
 assert.equal(item.supplier,'Makro');assert.equal(item.category,'Fresh Food');
 assert.equal(call(db,'/items/'+item.id,'PATCH',{purchaseCostMinor:35000,active:false}).data.item.active,0);
 assert.equal(call(db,'/items/'+item.id+'/history').data.history[0].change_percent,16.67);
 const recipe=food(db,'/recipes','POST',{name:'Patty',yieldQuantity:1,components:[{ingredientId:item.id,quantity:90}]}).data.recipe;
 assert.equal(recipe.cost_per_serve_minor,3150);
 assert.equal(call(db,'/items/'+item.id,'DELETE').status,409);
 assert.equal(call(db,'/items','GET',{}, {id:'other',role:'Cashier'}).status,403);
 assert.equal(call(db,'/items','GET',{}, {id:'manager',role:'Manager',permissions:new Set(['operations.purchasing'])}).status,200);
 const previous=process.env.PLATFORM_TENANT_ID;process.env.PLATFORM_TENANT_ID='tenant-one';
 try{assert.equal(call(db,'/items','GET',{}, {...owner,tenantId:'wrong'}).status,403);assert.equal(call(db,'/items','GET',{}, {...owner,tenantId:'tenant-one'}).status,200)}finally{if(previous===undefined)delete process.env.PLATFORM_TENANT_ID;else process.env.PLATFORM_TENANT_ID=previous}
});
test('atomic import preview, stale confirmation and CSV reimport',()=>{
 const db=fixture();const supplier=call(db,'/suppliers','POST',{name:'Supplier'}).data.record;
 const records=[{name:'Coke',brand:'Brand',supplierId:supplier.id,supplierSku:'123',packQuantity:12,packUnit:'each',purchaseCost:49,currency:'THB'}];
 const preview=call(db,'/import','POST',{records});assert.equal(preview.data.summary.create,1);
 assert.equal(call(db,'/items').data.items.length,0);
 assert.equal(call(db,'/import','POST',{records,confirm:true,expected:[{action:'update',id:'wrong',updatedAt:null}]}).status,409);
 const expected=preview.data.proposals.map(({action,id,updatedAt})=>({action,id,updatedAt}));
 assert.equal(call(db,'/import','POST',{records,confirm:true,expected}).data.created,1);
 const csv=call(db,'/export').data;assert.match(csv,/supplier_sku/);assert.match(csv,/Coke/);
 const item=call(db,'/items').data.items[0];const update=[{...records[0],id:item.id,purchaseCostMinor:5500}];
 const p=call(db,'/import','POST',{records:update}).data.proposals;
 assert.equal(call(db,'/import','POST',{records:update,confirm:true,expected:p.map(({action,id,updatedAt})=>({action,id,updatedAt}))}).data.updated,1);
 assert.equal(call(db,'/items/'+item.id+'/history').data.history.length,1);
 const bad=[{...records[0],id:item.id,purchaseCostMinor:6000},{...records[0],name:'Other',supplierSku:'different',purchaseCost:-1}];
 assert.equal(call(db,'/import','POST',{records:bad}).status,400);
 assert.equal(call(db,'/items/'+item.id).status,405);
 assert.equal(call(db,'/items').data.items[0].pack_cost_minor,5500);
});
test('new suppliers and categories join the same transaction as imported items',()=>{
 const db=fixture();const records=[{name:'Paper sleeves',supplier:'Other supplier',supplierSku:'P-1',category:'Packaging',packQuantity:100,packUnit:'each',purchaseCost:50,currency:'THB'}];
 const preview=call(db,'/import','POST',{records}).data;
 assert.deepEqual(preview.summary.newSuppliers,['Other supplier']);
 assert.equal(call(db,'/suppliers').data.suppliers.length,0);
 const expected=preview.proposals.map(({action,id,updatedAt})=>({action,id,updatedAt}));
 const committed=call(db,'/import','POST',{records,confirm:true,expected});assert.equal(committed.status,200);
 assert.equal(call(db,'/items').data.items[0].supplier,'Other supplier');
 assert.equal(call(db,'/items').data.items[0].category,'Packaging');
});
test('failed commit rolls back its new supplier, category, item and audit entries',()=>{
 const db=fixture();const records=[{name:'Sleeve',brand:'House',supplier:'New supplier',supplierSku:'A',category:'New category',packQuantity:100,packUnit:'each',purchaseCost:10},{name:'Sleeve',brand:'House',supplier:'New supplier',supplierSku:'B',category:'New category',packQuantity:100,packUnit:'each',purchaseCost:12}];
 const preview=call(db,'/import','POST',{records});assert.equal(preview.status,200);
 const expected=preview.data.proposals.map(({action,id,updatedAt})=>({action,id,updatedAt}));
 assert.equal(call(db,'/import','POST',{records,confirm:true,expected}).status,409);
 assert.equal(call(db,'/items').data.items.length,0);
 assert.equal(call(db,'/suppliers').data.suppliers.length,0);
 assert.equal(call(db,'/categories').data.categories.some(x=>x.name==='New category'),false);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM food_model_audit WHERE entity_type='purchasing_item'").get().n,0);
});
test('renamed admin categories stay excluded from recipe selection',()=>{
 const db=fixture(),category=call(db,'/categories').data.categories.find(x=>x.name==='Admin');assert.equal(category.recipe_eligible,0);
 const renamed=call(db,'/categories/'+category.id,'PATCH',{name:'Office supplies',recipeEligible:false}).data.record;assert.equal(renamed.recipe_eligible,0);
 const item=call(db,'/items','POST',{name:'Paper',categoryId:category.id,packQuantity:100,packUnit:'each',purchaseCost:40}).data.item;
 assert.equal(item.recipe_eligible,0);
});
test('decimal purchase prices and modifier measurement families remain safe',()=>{
 const db=fixture();const item=call(db,'/items','POST',{name:'Sauce',packQuantity:1,packUnit:'kg',purchaseCost:19.99}).data.item;
 assert.equal(item.pack_cost_minor,1999);
 assert.equal(call(db,'/items/'+item.id,'PATCH',{purchaseCost:20.01}).data.item.pack_cost_minor,2001);
 assert.equal(call(db,'/items/'+item.id,'PATCH',{purchaseCost:20.001}).status,400);
 db.exec("CREATE TABLE food_modifier_ingredients(option_id TEXT,ingredient_id TEXT,quantity REAL);INSERT INTO food_modifier_ingredients VALUES('m','"+item.id+"',20)");
 assert.equal(call(db,'/items/'+item.id,'PATCH',{packUnit:'each'}).status,409);
 assert.equal(call(db,'/items/'+item.id,'PATCH',{packUnit:'g',packQuantity:1000}).status,200);
});
test('supplier price updates require exact SKU and retain recipe relationships',()=>{
 const db=fixture();const supplier=call(db,'/suppliers','POST',{name:'Makro'}).data.record;
 const item=call(db,'/items','POST',{name:'Bun',supplierId:supplier.id,supplierSku:'B-123',packQuantity:12,packUnit:'each',purchaseCost:120}).data.item;
 const recipe=food(db,'/recipes','POST',{name:'Burger',yieldQuantity:1,components:[{ingredientId:item.id,quantity:1}]}).data.recipe;
 const rows=[{supplier:'Makro',supplierSku:'B-123',purchaseCost:132,lastUpdated:'2026-11-17'}];
 const preview=call(db,'/price-update','POST',{records:rows}).data;
 assert.equal(preview.proposals[0].id,item.id);
 assert.equal(call(db,'/price-update','POST',{records:[{...rows[0],supplierSku:'wrong'}]}).status,409);
 assert.equal(call(db,'/price-update','POST',{records:rows,confirm:true,expected:preview.proposals.map(({id,updatedAt})=>({id,updatedAt}))}).status,200);
 assert.equal(food(db,'/recipes/'+recipe.id).data.recipe.cost_per_serve_minor,1100);
 assert.equal(call(db,'/items/'+item.id+'/history').data.history[0].source,'supplier price update');
});

test('SBB source measurements and historical unit cost survive export and reimport',()=>{
 const db=fixture(),record={name:'Coke',supplier:'Makro',supplierSku:'177800',packQuantity:6,packUnit:'each',unitsPerPack:6,eachQuantity:1,eachUnit:'each',purchaseCost:81,externalId:'1',sourceBaseUnit:'6 Cans',sourceUnitCost:'13.5'};
 const preview=call(db,'/import','POST',{records:[record]}).data;
 assert.equal(call(db,'/import','POST',{records:[record],confirm:true,expected:preview.proposals.map(({action,id,updatedAt})=>({action,id,updatedAt}))}).status,200);
 const item=call(db,'/items').data.items[0];
 assert.equal(item.source_base_unit,'6 Cans');
 assert.equal(item.source_unit_cost,'13.5');
 assert.equal(item.pack_quantity,6);
 const csv=call(db,'/export').data;
 assert.match(csv,/"source_base_unit","source_unit_cost"/);
 assert.match(csv,/"6 Cans","13.5"/);
 assert.equal(call(db,'/items/'+item.id,'PATCH',{purchaseCost:84}).data.item.source_base_unit,'6 Cans');
 const other={...record,name:'Paper',brand:'',supplierSku:'',purchaseCost:10,externalId:'1'};
 assert.equal(call(db,'/import','POST',{records:[other]}).status,409);
 assert.equal(call(db,'/items').data.items.length,1);
});
