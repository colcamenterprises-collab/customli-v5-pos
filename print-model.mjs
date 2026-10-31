import {createHash,randomUUID} from 'node:crypto';
export const purposes=['customer','payment','kitchen','packing','delivery','summary_label','package_label'];
export const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const now=()=>new Date().toISOString();
export function defaults(purpose){return {name:purpose.replaceAll('_',' '),purpose,width:purpose.endsWith('label')?100:80,height:purpose.endsWith('label')?50:0,fontSize:purpose.endsWith('label')?12:16,businessName:'',address:'',phone:'',taxId:'',header:'',footer:'',logoAsset:'',logoPosition:'center',showModifiers:true,checkboxes:purpose==='packing',componentBoxes:purpose==='packing',signoff:purpose==='packing',checker:false,showTime:true,timezone:'Asia/Bangkok',marketingUrl:'',marketingCaption:'',qrSize:'medium',qrChannels:[],campaignStart:'',campaignEnd:'',paymentAsset:'',packageQr:false};}
export function validateTemplate(t){
 if(!purposes.includes(t.purpose))fail(400,'Choose a template purpose.');
 const out=defaults(t.purpose);
 for(const k of ['name','businessName','address','phone','taxId','header','footer','marketingUrl','marketingCaption','logoAsset','paymentAsset','timezone','logoPosition','campaignStart','campaignEnd']){out[k]=String(t[k]??out[k]).trim();if(out[k].length>(['header','footer','address'].includes(k)?500:250))fail(400,'Shorten '+k+'.');if(/[\x00-\x08\x0b-\x1f]/.test(out[k]))fail(400,'Remove control characters.');}
 try{new Intl.DateTimeFormat('en',{timeZone:out.timezone})}catch{fail(400,'Choose a valid time zone.');}
 for(const k of ['showModifiers','checkboxes','componentBoxes','signoff','checker','showTime','packageQr'])out[k]=Boolean(t[k]??out[k]);
 out.width=Number(t.width);out.height=Number(t.height||0);out.fontSize=Number(t.fontSize||out.fontSize);
 if(!Number.isFinite(out.fontSize)||!Number.isInteger(out.width)||!Number.isInteger(out.height)||out.width<30||out.width>110||out.height<0||out.height>200||out.fontSize<10||out.fontSize>24)fail(400,'Check paper dimensions and text size.');
 if(t.purpose.endsWith('label')?out.height<20:![58,80].includes(out.width))fail(400,'Select supported paper dimensions.');
 if(out.marketingUrl){let u;try{u=new URL(out.marketingUrl)}catch{fail(400,'Enter a complete HTTPS marketing link.');}if(u.protocol!=='https:'||u.username||u.password)fail(400,'Use a public HTTPS marketing link.');}
 if(!['left','center','right'].includes(out.logoPosition))fail(400,'Choose a logo position.');
 out.qrSize=['small','medium','large'].includes(t.qrSize)?t.qrSize:'medium';out.qrChannels=Array.isArray(t.qrChannels)?t.qrChannels.map(String).slice(0,40):[];
 for(const k of ['campaignStart','campaignEnd'])if(out[k]&&!Number.isFinite(Date.parse(out[k])))fail(400,'Check campaign dates.');
 for(const k of ['campaignStart','campaignEnd'])if(out[k])out[k]=new Date(out[k]).toISOString();
 if(out.campaignStart&&out.campaignEnd&&out.campaignStart>out.campaignEnd)fail(400,'Campaign end must follow its start.');
 return out;
}
export function migratePrint(db){db.exec(`
 CREATE TABLE IF NOT EXISTS print_location(id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS receipt_templates(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,purpose TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS receipt_template_versions(template_id TEXT NOT NULL,version INTEGER NOT NULL,location_id TEXT NOT NULL,config TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(template_id,version));
 CREATE TABLE IF NOT EXISTS receipt_assets(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,data TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS printer_devices(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,name TEXT NOT NULL,physical_key TEXT NOT NULL,profile TEXT NOT NULL,token_hash TEXT,pair_hash TEXT,pair_expires TEXT,revoked INTEGER NOT NULL DEFAULT 0,last_seen TEXT,agent_session TEXT,agent_expires TEXT,UNIQUE(location_id,physical_key));
 CREATE TABLE IF NOT EXISTS printer_routes(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,printer_id TEXT NOT NULL,template_id TEXT NOT NULL,trigger TEXT NOT NULL,filters TEXT NOT NULL,backup_id TEXT,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS print_batches(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,event_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS print_jobs(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,batch_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,printer_id TEXT NOT NULL,purpose TEXT NOT NULL,snapshot TEXT NOT NULL,content_hash TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'queued',lease_token TEXT,lease_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt TEXT,last_error TEXT,parent_id TEXT,created_at TEXT NOT NULL,completed_at TEXT);
 CREATE INDEX IF NOT EXISTS print_queue ON print_jobs(location_id,printer_id,status,created_at);
 CREATE TABLE IF NOT EXISTS print_job_attempts(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,lease_token TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS print_events(id INTEGER PRIMARY KEY AUTOINCREMENT,location_id TEXT NOT NULL,job_id TEXT,actor_id TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS packing_rules(product_id TEXT PRIMARY KEY,location_id TEXT NOT NULL,config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS order_packing_snapshots(order_id TEXT PRIMARY KEY,location_id TEXT NOT NULL,snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS packing_verifications(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,unit_id TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,exception TEXT NOT NULL,UNIQUE(location_id,order_id,revision,unit_id));
 CREATE TABLE IF NOT EXISTS print_source_events(source_key TEXT PRIMARY KEY,location_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,payload_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS print_snapshot_immutable BEFORE UPDATE OF snapshot,content_hash,batch_id,order_id,revision,printer_id,purpose,location_id ON print_jobs BEGIN SELECT RAISE(ABORT,'Print snapshot is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS template_version_immutable BEFORE UPDATE ON receipt_template_versions BEGIN SELECT RAISE(ABORT,'Template version is immutable'); END;
 `);
 if(!db.prepare('SELECT id FROM print_location').get())db.prepare('INSERT INTO print_location VALUES(?)').run(randomUUID());
 const loc=location(db);for(const purpose of purposes)if(!db.prepare('SELECT id FROM receipt_templates WHERE location_id=? AND purpose=?').get(loc,purpose)){const id=randomUUID(),t=defaults(purpose);db.prepare('INSERT INTO receipt_templates(id,location_id,purpose,name,version) VALUES(?,?,?,?,1)').run(id,loc,purpose,t.name);db.prepare('INSERT INTO receipt_template_versions VALUES(?,?,?,?,?,?)').run(id,1,loc,JSON.stringify(t),'system',now());}
}
export const location=db=>db.prepare('SELECT id FROM print_location').get().id;
export function audit(db,loc,actor,action,details={},job=null){db.prepare('INSERT INTO print_events(location_id,job_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?,?)').run(loc,job,actor,action,JSON.stringify(details),now());}
export function templates(db,loc){return db.prepare('SELECT t.*,v.config FROM receipt_templates t JOIN receipt_template_versions v ON v.template_id=t.id AND v.version=t.version WHERE t.location_id=? AND t.active=1 ORDER BY t.rowid').all(loc).map(x=>({...x,config:JSON.parse(x.config)}));}
export function validatePackingRule(db,productId,config){
 if(!db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId))fail(404,'Menu item not found.');
 if(!['single','meal'].includes(config.kind)||!['separate','combined'].includes(config.mode))fail(400,'Select the package arrangement.');
 const components=config.components||[];if(!Array.isArray(components)||components.length>30||config.kind==='meal'&&!components.length)fail(400,'Add the actual meal components.');
 for(const c of components){if(!c.name||String(c.name).length>100||!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>30)fail(400,'Check component names and quantities.');if(c.optionId&&!db.prepare('SELECT 1 FROM modifier_options o JOIN product_modifier_groups p ON p.group_id=o.group_id WHERE p.product_id=? AND o.id=? AND o.active=1').get(productId,c.optionId))fail(400,'Select a modifier assigned to this item.');}
 if(new Set(components.filter(c=>c.optionId).map(c=>c.optionId)).size!==components.filter(c=>c.optionId).length)fail(400,'A selected option can be packed only once.');
 return {kind:config.kind,mode:config.mode,components:components.map((c,i)=>({id:String(i),name:String(c.name),quantity:c.quantity,optionId:c.optionId||'',station:String(c.station||'')}))};
}
export function resolvePacking(db,order){
 const saved=db.prepare('SELECT snapshot FROM order_packing_snapshots WHERE order_id=?').get(order.id);if(saved)return JSON.parse(saved.snapshot);
 const lines=order.items.map(line=>{
 const row=db.prepare('SELECT config FROM packing_rules WHERE product_id=? AND location_id=?').get(line.product_id,location(db));const rule=row?JSON.parse(row.config):{kind:'single',mode:'separate',components:[]};
 const hasRoutes=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='kds_option_routes'").get());if(!row&&hasRoutes){for(const m of line.modifiers||[]){const route=db.prepare('SELECT station FROM kds_option_routes WHERE option_id=?').get(m.optionId);if(route)rule.components.push({id:'option-'+m.optionId,name:m.name,quantity:1,optionId:m.optionId,station:route.station});}}
 const station=hasRoutes?db.prepare('SELECT station FROM kds_product_routes WHERE product_id=?').get(line.product_id)?.station||'':'';
 const components=rule.kind==='single'?[{id:line.id+':main',name:line.name,quantity:line.quantity,sku:line.product_id,station}]:[];
 for(const c of rule.components){const choice=c.optionId?(line.modifiers||[]).find(m=>m.optionId===c.optionId):null;if(c.optionId&&!choice)continue;components.push({id:line.id+':'+c.id,name:choice?.name||c.name,quantity:line.quantity*c.quantity*(choice?.quantity||1),sku:c.optionId||line.product_id,station:c.station||station});}
 if(!components.length)fail(409,'The selected meal has no packing components. Review its packing rules.');
 return {lineId:line.id,name:line.name,quantity:line.quantity,originalQuantity:line.quantity,mode:rule.mode,components,modifiers:line.modifiers||[],instructions:line.instructions||''};});
 return {revision:1,lines,units:packingUnits(lines)};
}
export function packingUnits(lines){const units=[];for(const line of lines)for(const c of line.components){if(!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>3000)fail(400,'Invalid packing quantity.');const count=line.mode==='combined'?1:c.quantity;for(let i=0;i<count;i++)units.push({id:c.id+':'+i,lineId:line.lineId,componentId:c.id,name:c.name,quantity:line.mode==='combined'?c.quantity:1,parent:line.name,modifiers:line.modifiers,instructions:line.instructions,sku:c.sku,station:c.station||''});}if(units.length>1000)fail(400,'This order has too many separate packages.');return units;}
export function snapshotPacking(db,order){const packing=resolvePacking(db,order);db.prepare('INSERT OR IGNORE INTO order_packing_snapshots VALUES(?,?,?)').run(order.id,location(db),JSON.stringify(packing));return packing;}
export const sampleOrder=()=>({id:'preview',receipt_number:'SAMPLE',created_at:now(),status:'paid',payment_method:'QR',channel_id:'in-store',mode:'Takeaway',subtotal:30000,tax:0,total:30000,discount_total:0,refund_total:0,items:[{id:'sample-burger',product_id:'sample',name:'Double Burger / ดับเบิลเบอร์เกอร์',price:12000,quantity:2,modifiers:[{name:'No onion',quantity:1}],instructions:'Sauce on the side'},{id:'sample-fries',product_id:'fries',name:'French fries',price:6000,quantity:1,modifiers:[]}]});
export function simplePacking(order){const lines=order.items.map(x=>({lineId:x.id,name:x.name,quantity:x.quantity,mode:'separate',components:[{id:x.id+':main',sku:x.product_id,name:x.name,quantity:x.quantity}],modifiers:x.modifiers||[],instructions:x.instructions||''}));return {revision:1,lines,units:packingUnits(lines)};}
export function createDocuments(order,template,packing,meta={}){
 const p=template.purpose,base={schema:1,template,order:structuredClone(order),packing,revision:packing.revision,reprint:packing.revision>1?'REPLACEMENT revision '+packing.revision:undefined,...meta};
 if(p==='payment'&&order.status!=='unpaid')fail(409,'Payment requests are only for unpaid orders.');
 if(p==='package_label')return [...packing.units.map((unit,i)=>({...base,unit,sequence:i+1,packageCount:packing.units.length})),...(packing.voidUnits||[]).map(unit=>({...base,unit,void:true,sequence:0,packageCount:packing.units.length}))];
 return [{...base,packageCount:packing.units.length}];
}
export function enqueuePrint(db,order,event='sale.completed',actor='system',eventId=''){const loc=location(db),packing=resolvePacking(db,order),key=[loc,order.id,packing.revision,event,eventId].join(':');
 const existing=db.prepare('SELECT id FROM print_batches WHERE event_key=?').get(key);if(existing)return existing.id;
 const batchId=randomUUID();db.prepare('INSERT INTO print_batches VALUES(?,?,?,?,?,?)').run(batchId,loc,order.id,packing.revision,key,now());
 const all=templates(db,loc),routes=db.prepare('SELECT * FROM printer_routes WHERE location_id=? AND trigger=? AND active=1').all(loc,event),seen=new Set();
 for(const route of routes){const t=all.find(t=>t.id===route.template_id),device=db.prepare('SELECT * FROM printer_devices WHERE id=? AND location_id=? AND revoked=0').get(route.printer_id,loc);if(!t||!device)continue;
 const filter=JSON.parse(route.filters);if(filter.channels?.length&&!filter.channels.includes(order.channel_id))continue;
 let routed=packing;if(t.purpose==='kitchen'&&(filter.products?.length||filter.categories?.length||filter.station)){
 const ids=new Set(order.items.filter(i=>!filter.products?.length||filter.products.includes(i.product_id)).filter(i=>!filter.categories?.length||filter.categories.includes(i.category)).map(i=>i.id));
 const lines=packing.lines.filter(l=>ids.has(l.lineId)).map(l=>({...l,components:l.components.filter(c=>!filter.station||c.station===filter.station)})).filter(l=>l.components.length);if(!lines.length)continue;routed={...packing,lines,units:packingUnits(lines)};
 }
 const dedupe=route.printer_id+':'+t.purpose;if(seen.has(dedupe))continue;seen.add(dedupe);if(t.purpose==='kitchen'){const siblings=routes.filter(r=>r.printer_id===route.printer_id&&all.find(x=>x.id===r.template_id)?.purpose==='kitchen');const selected=new Set(routed.lines.flatMap(l=>l.components.map(c=>c.id)));for(const r of siblings){const f=JSON.parse(r.filters);if(f.channels?.length&&!f.channels.includes(order.channel_id))continue;for(const line of packing.lines){const item=order.items.find(i=>i.id===line.lineId);if(f.products?.length&&!f.products.includes(item?.product_id)||f.categories?.length&&!f.categories.includes(item?.category))continue;for(const c of line.components)if(!f.station||c.station===f.station)selected.add(c.id);}}const lines=packing.lines.map(l=>({...l,components:l.components.filter(c=>selected.has(c.id))})).filter(l=>l.components.length);routed={...packing,lines,units:packingUnits(lines)};}
 const documents=createDocuments(order,t.config,routed,{batchId,templateId:t.id,templateVersion:t.version});
 for(const [i,document] of documents.entries()){const snapshot=JSON.stringify(document),id=randomUUID();db.prepare('INSERT OR IGNORE INTO print_jobs(id,location_id,batch_id,order_id,revision,printer_id,purpose,snapshot,content_hash,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,loc,batchId,order.id,packing.revision,device.id,t.purpose,snapshot,hash(snapshot),key+':'+dedupe+':'+i,now());}
 }audit(db,loc,actor,'batch.created',{batchId,event,orderId:order.id});return batchId;
}

// Refunds change the packing revision, never historical sales or prior print snapshots.
export function revisePacking(db,order,actor){const row=db.prepare('SELECT snapshot FROM order_packing_snapshots WHERE order_id=?').get(order.id);if(!row)return;const prior=JSON.parse(row.snapshot),lines=[];
 for(const line of prior.lines){const sold=order.items.find(i=>i.id===line.lineId);if(!sold)continue;const remaining=Math.max(0,sold.quantity-(sold.refunded_quantity||0));if(!remaining)continue;const components=line.components.map(c=>({...c,quantity:c.quantity*remaining/line.quantity}));if(components.some(c=>!Number.isSafeInteger(c.quantity)))fail(409,'Packing quantities require review.');lines.push({...line,quantity:remaining,components});}
 const units=packingUnits(lines),snapshot={revision:prior.revision+1,lines,units,voidUnits:prior.units.filter(u=>!units.some(n=>n.id===u.id))};db.prepare('UPDATE order_packing_snapshots SET snapshot=? WHERE order_id=?').run(JSON.stringify(snapshot),order.id);
 db.prepare("UPDATE print_jobs SET status='skipped',last_error='Superseded by order revision' WHERE order_id=? AND status='queued' AND purpose IN ('packing','kitchen','summary_label','package_label')").run(order.id);
 db.prepare("UPDATE print_jobs SET status='uncertain',last_error='Order changed during printing. Review old labels.' WHERE order_id=? AND status='printing'").run(order.id);
 audit(db,location(db),actor,'packing.revised',{orderId:order.id,revision:snapshot.revision,voidUnits:snapshot.voidUnits.map(u=>u.id)});enqueuePrint(db,order,'order.revised',actor);
}
