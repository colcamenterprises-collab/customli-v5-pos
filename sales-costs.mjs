// Immutable recipe and modifier ingredient cost snapshots at point of sale.
// All monetary values are integer THB satang. Unknown costs are never treated as zero.
const units={g:1,kg:1000,ml:1,L:1000,each:1};
const costOf=(r,quantity)=>Math.round(quantity/(r.pack_quantity*units[r.pack_unit])*r.pack_cost_minor);
export function migrateSaleCosts(db){
 db.exec(`CREATE TABLE IF NOT EXISTS order_item_cost_snapshots (
  order_item_id TEXT PRIMARY KEY REFERENCES order_items(id),
  recipe_id TEXT,recipe_name TEXT,
  per_item_cost_minor INTEGER,
  total_cost_minor INTEGER,
  quantity INTEGER NOT NULL,
  complete INTEGER NOT NULL CHECK(complete IN (0,1)),
  reason TEXT NOT NULL DEFAULT '',
  components_json TEXT NOT NULL DEFAULT '[]',
  recorded_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS food_modifier_ingredients (
  option_id TEXT NOT NULL REFERENCES modifier_options(id),
  ingredient_id TEXT NOT NULL REFERENCES food_ingredients(id),
  quantity REAL NOT NULL CHECK(quantity<>0),
  PRIMARY KEY(option_id,ingredient_id));`);
}
export function snapshotSaleCost(db,lineId,productId,qty){
 const recipe=db.prepare('SELECT * FROM food_recipes WHERE product_id=?').get(productId);
 const mods=db.prepare('SELECT option_id,option_name,quantity FROM order_item_modifiers WHERE order_item_id=?').all(lineId);
 let complete=true,reason='',components=[],unitCost=null;
 if(!recipe){complete=false;reason='No linked recipe';}
 else{
  const ingredients=db.prepare('SELECT i.*,c.quantity FROM food_recipe_components c JOIN food_ingredients i ON i.id=c.ingredient_id WHERE c.recipe_id=?').all(recipe.id);
  if(!ingredients.length){complete=false;reason='Recipe has no ingredient quantities';}
  else{
   components=ingredients.map(r=>({ingredient_id:r.id,name:r.name,quantity:r.quantity,cost_minor:costOf(r,r.quantity)}));
   let batch=components.reduce((n,r)=>n+r.cost_minor,0)+recipe.packaging_cost_minor;
   unitCost=Math.round(Math.round(batch*(1+recipe.waste_percent/100))/recipe.yield_quantity);
  }
 }
 if(complete){
  for(const m of mods){
   const mappings=db.prepare('SELECT i.*,fm.quantity FROM food_modifier_ingredients fm JOIN food_ingredients i ON i.id=fm.ingredient_id WHERE fm.option_id=?').all(m.option_id);
   if(!mappings.length){complete=false;reason='Modifier missing ingredient mapping: '+m.option_name;break;}
   for(const ing of mappings){const c=costOf(ing,ing.quantity*m.quantity);unitCost+=c;components.push({ingredient_id:ing.id,name:ing.name,modifier:m.option_name,quantity:ing.quantity*m.quantity,cost_minor:c});}
  }
 }
 if(complete&&unitCost<0){complete=false;reason='Modifier deductions exceed recipe cost';}
 db.prepare('INSERT INTO order_item_cost_snapshots(order_item_id,recipe_id,recipe_name,per_item_cost_minor,total_cost_minor,quantity,complete,reason,components_json,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(lineId,recipe?.id||null,recipe?.name||null,complete?unitCost:null,complete?unitCost*qty:null,qty,complete?1:0,reason,JSON.stringify(components),new Date().toISOString());
}
export function shiftCostSummary(db,shiftId){
 if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='order_item_cost_snapshots'").get())return {costs_available:false,costed_lines:0,items_to_cost:db.prepare('SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.shift_id=?').get(shiftId).n,known_cogs_minor:0,cogs_minor:null};
 const s=db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN c.complete=1 THEN 1 ELSE 0 END),0) AS complete_lines,COALESCE(SUM(CASE WHEN c.complete=1 THEN c.total_cost_minor ELSE 0 END),0) AS known_cogs
  FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN order_item_cost_snapshots c ON c.order_item_id=oi.id WHERE o.shift_id=? AND o.status IN ('paid','refunded')`).get(shiftId);
 return {costs_available:s.total>0&&s.total===s.complete_lines,costed_lines:s.complete_lines,items_to_cost:s.total,known_cogs_minor:s.known_cogs,cogs_minor:s.total>0&&s.total===s.complete_lines?s.known_cogs:null};
}
