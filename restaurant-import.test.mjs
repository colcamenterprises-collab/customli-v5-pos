import {DatabaseSync} from 'node:sqlite';
import {handleBatchImport} from './restaurant-import.mjs';
const db=new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON;CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT UNIQUE,sort_order INTEGER,image TEXT DEFAULT '',icon TEXT DEFAULT '',active INTEGER DEFAULT 1);CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT UNIQUE,category TEXT,price INTEGER,active INTEGER DEFAULT 1,description TEXT DEFAULT '');CREATE TABLE food_ingredients(id TEXT PRIMARY KEY,name TEXT UNIQUE,base_unit TEXT,pack_quantity REAL,pack_unit TEXT,pack_cost_minor INTEGER,updated_at TEXT);CREATE TABLE food_recipes(id TEXT PRIMARY KEY,name TEXT UNIQUE,yield_quantity REAL,packaging_cost_minor INTEGER,waste_percent REAL,target_price_minor INTEGER,product_id TEXT UNIQUE,instructions TEXT,updated_at TEXT);CREATE TABLE food_recipe_components(recipe_id TEXT,ingredient_id TEXT,quantity REAL,PRIMARY KEY(recipe_id,ingredient_id));");
const owner={role:'Owner'};
function run(kind,records){let code,data;const res={writeHead(n){code=n},end(s){data=JSON.parse(s)}};handleBatchImport({db,p:'/restaurant-import/batch',method:'POST',b:{kind,records},user:owner,res});return {code,data}}
function assert(x,m){if(!x)throw Error(m)}
assert(run('categories',[{name:'Burgers'}]).code===201,'category');
assert(run('menu',[{name:'Single',category:'Burgers',price:'199'}]).code===201,'menu');
assert(run('ingredients',[{name:'Beef',packUnit:'kg',packQuantity:'1',packCost:'350'}]).code===201,'ingredient');
assert(run('recipes',[{name:'Single recipe',product:'Single',components:[{ingredient:'Beef',quantity:90}]}]).code===201,'recipe');
const before=db.prepare('SELECT count(*) n FROM food_ingredients').get().n;
assert(run('ingredients',[{name:'Cheese',packUnit:'each',packQuantity:10,packCost:50},{name:'Broken',packUnit:'bad',packQuantity:1,packCost:1}]).code===400,'validation rejection');
assert(db.prepare('SELECT count(*) n FROM food_ingredients').get().n===before,'validation rollback');
db.exec("CREATE TRIGGER reject_ingredient BEFORE INSERT ON food_ingredients WHEN NEW.name='Rejected' BEGIN SELECT RAISE(ABORT,'test');END");
assert(run('ingredients',[{name:'First',packUnit:'each',packQuantity:1,packCost:1},{name:'Rejected',packUnit:'each',packQuantity:1,packCost:1}]).code===500,'transaction failure');
assert(db.prepare("SELECT count(*) n FROM food_ingredients WHERE name='First'").get().n===0,'transaction rollback');
console.log('PASS: category, menu, ingredient, recipe; validation rollback; SQLite failure rollback');
const auto=run('menu',[{name:'New dish 1',category:'New category',price:'100'},{name:'New dish 2',category:'New category',price:'120'}]);
assert(auto.code===201,'auto category import');
assert(db.prepare("SELECT count(*) n FROM categories WHERE name='New category'").get().n===1,'create category once');
assert(db.prepare("SELECT count(*) n FROM products WHERE category='New category'").get().n===2,'both menu items imported');
const failed=run('menu',[{name:'Will rollback',category:'Rollback category',price:'100'},{name:'Single',category:'Rollback category',price:'100'}]);
assert(failed.code===409,'duplicate menu rejection');
assert(db.prepare("SELECT count(*) n FROM categories WHERE name='Rollback category'").get().n===0,'no category on rejected batch');
console.log('PASS: menu auto-creates categories once; rejected batch creates nothing');
