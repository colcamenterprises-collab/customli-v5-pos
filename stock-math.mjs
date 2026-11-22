// Quantities are stored in an item's base unit: g, ml or each. Packaging
// conversions belong to the purchasing item, never to the unit name alone.
const simple={mg:['g',0.001],g:['g',1],kg:['g',1000],ml:['ml',1],L:['ml',1000],each:['each',1],piece:['each',1],slice:['each',1],bottle:['each',1],can:['each',1]};
const packaging=new Set(['pack','box','carton','case']);
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
const decimal=value=>{const n=Number(value);if(!Number.isFinite(n)||n<0||n>1e9)fail('Enter a valid non-negative quantity.');return n};
const round=value=>Math.round((value+Number.EPSILON)*1e6)/1e6;

export function toBase(item,quantity,unit){
 const n=decimal(quantity),base=item.base_unit;
 if(unit==='each'&&item.pack_unit==='each'&&item.each_unit!=='each'){
  const each=simple[item.each_unit];if(!each||each[0]!==base)fail('This measurement is incompatible with the item.');
  return round(n*decimal(item.each_quantity)*each[1]);
 }
 const direct=simple[unit];
 if(direct){if(direct[0]!==base)fail('This measurement is incompatible with the item.');return round(n*direct[1])}
 if(packaging.has(unit)){
  if(String(item.pack_type||'').trim().toLowerCase()!==unit)fail('Configure this packaging unit for the item first.');
  return round(n*purchasePackBase(item));
 }
 if(unit!==item.pack_unit)fail('Choose a supported measurement.');
 const pack=simple[item.pack_unit],each=simple[item.each_unit];
 if(!pack||!each)fail('The purchasing item has an invalid pack conversion.');
 const factor=item.pack_unit==='each'&&item.each_unit!=='each'
  ?decimal(item.pack_quantity)*decimal(item.each_quantity)*each[1]
  :decimal(item.pack_quantity)*pack[1];
 const dimension=item.pack_unit==='each'&&item.each_unit!=='each'?each[0]:pack[0];
 if(dimension!==base||factor<=0)fail('The purchasing item has an incompatible pack conversion.');
 return round(n*factor);
}

export function purchasePackBase(item){
 const pack=simple[item.pack_unit],each=simple[item.each_unit];
 if(!pack||!each)fail('The purchasing item has an invalid pack conversion.');
 const unit=item.pack_unit==='each'&&item.each_unit!=='each'?each:pack;
 if(unit[0]!==item.base_unit)fail('The purchase pack is incompatible with the item.');
 return round(decimal(item.pack_quantity)*(item.pack_unit==='each'&&item.each_unit!=='each'?decimal(item.each_quantity):1)*unit[1]);
}

export function variance({opening,received=0,additions=0,consumed,wastage=0,reductions=0,closing,tolerance=0}){
 if(opening==null||consumed==null||closing==null)return {status:'calculation_incomplete',expected:null,difference:null};
 const expected=round(opening+received+additions-consumed-wastage-reductions);
 const difference=round(closing-expected);
 return {status:Math.abs(difference)>tolerance?'outside_tolerance':'within_tolerance',expected,difference};
}

export function suggestPurchase({onHand,target,inbound=0,packBase,additional=0}){
 if([onHand,target,inbound,additional].some(n=>n==null||!Number.isFinite(Number(n))))return null;
 if(!Number.isFinite(packBase)||packBase<=0)return null;
 const required=Math.max(0,target-onHand-inbound+additional);
 const packs=Math.ceil((required-1e-8)/packBase);
 return {requiredBase:round(required),packs,quantityBase:round(packs*packBase)};
}

// Uses the sale-time snapshot. Older snapshots lacking base quantities are
// incomplete; a changed recipe must never change an old stock report.
export function consumptionFromSnapshots(rows,itemId){
 let quantity=0;const missing=[];
 for(const row of rows){
  if(!row.complete){missing.push({orderItemId:row.order_item_id,reason:row.reason||'Uncosted sale'});continue}
  let components;
  try{components=JSON.parse(row.components_json)}catch{missing.push({orderItemId:row.order_item_id,reason:'Invalid sale snapshot'});continue}
  if(!Array.isArray(components)||components.some(c=>c.line_type==='ingredient'&&!c.ingredient_id||c.ingredient_id&&(!Number.isFinite(c.stock_base_per_item)||c.stock_base_per_item<0&&c.line_type!=='modifier'))){missing.push({orderItemId:row.order_item_id,reason:'Sale has no complete stock snapshot'});continue}
  const perIngredient=new Map();for(const component of components)if(component.ingredient_id)perIngredient.set(component.ingredient_id,(perIngredient.get(component.ingredient_id)||0)+component.stock_base_per_item);
  if([...perIngredient.values()].some(value=>value< -1e-6)){missing.push({orderItemId:row.order_item_id,reason:'Modifier reductions exceed recipe stock usage'});continue}
  quantity+=Math.max(0,perIngredient.get(itemId)||0)*row.quantity;
 }
 return {quantity:missing.length?null:round(quantity),knownQuantity:round(quantity),missing};
}
