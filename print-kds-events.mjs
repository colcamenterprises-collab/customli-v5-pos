import {randomUUID} from 'node:crypto';
import {audit,enqueuePrint,location,now,resolvePacking} from './print-model.mjs';
export function publishKitchenPrintEvents({db,kds,tenantId,getOrder,fromBeginning=false}){
 if(!tenantId)throw Error('Configure the KDS tenant identity.');const loc=location(db);
 db.exec('CREATE TABLE IF NOT EXISTS print_kds_cursor(location_id TEXT PRIMARY KEY,seq INTEGER NOT NULL)');
 const last=kds.prepare('SELECT COALESCE(MAX(seq),0) n FROM events WHERE tenant_id=?').get(tenantId).n;db.prepare('INSERT OR IGNORE INTO print_kds_cursor VALUES(?,?)').run(loc,fromBeginning?0:last);
 const cursor=db.prepare('SELECT seq FROM print_kds_cursor WHERE location_id=?').get(loc).seq;
 const events=kds.prepare('SELECT e.*,o.source_order_id FROM events e JOIN orders o ON o.id=e.order_id WHERE e.tenant_id=? AND e.seq>? ORDER BY e.seq LIMIT 100').all(tenantId,cursor);let processed=0;
 for(const e of events){const order=getOrder(e.source_order_id),data=JSON.parse(e.data);db.exec('BEGIN IMMEDIATE');try{
 if(order){const packing=resolvePacking(db,order);if(e.event_type==='STATION_ACCEPTED'){enqueuePrint(db,order,'order.accepted',e.actor_id);if(data.station==='Expo')enqueuePrint(db,order,'packing.started',e.actor_id);}
 if(e.event_type==='STATION_COMPLETE'&&!kds.prepare('SELECT 1 FROM components WHERE order_id=? AND completed_qty<quantity').get(e.order_id))enqueuePrint(db,order,'kitchen.ready',e.actor_id);
 if(e.event_type==='COMPONENT_PACKED'){const c=kds.prepare('SELECT * FROM components WHERE id=? AND order_id=?').get(data.componentId,e.order_id);if(c){const units=packing.units.filter(u=>u.componentId===c.source_component_id||u.componentId===c.id);let count=0;for(const u of units){count+=u.quantity;if(count<=c.packed_qty)db.prepare('INSERT OR IGNORE INTO packing_verifications VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),loc,order.id,packing.revision,u.id,e.actor_id,e.occurred_at,'KDS device '+e.device_id);}}audit(db,loc,e.actor_id,'kds.component_packed',{sourceEvent:e.id,device:e.device_id,component:data.componentId});}
 if(e.event_type==='READY')enqueuePrint(db,order,'packing.verified',e.actor_id);
 }
 db.prepare('UPDATE print_kds_cursor SET seq=? WHERE location_id=?').run(e.seq,loc);db.exec('COMMIT');processed++;
 }catch(error){db.exec('ROLLBACK');throw error;}}
 return processed;
}
