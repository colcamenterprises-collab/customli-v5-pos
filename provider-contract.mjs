import {createHmac,timingSafeEqual,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {fail,hash,now} from './print-model.mjs';
// Provider-specific adapters must verify the provider's actual signature scheme before calling commit.
// No delivery or bank connection is activated by this module.
export function verifySignedEvent({raw,signature,timestamp,secret,clock=Date.now()}){
 if(!Buffer.isBuffer(raw)||raw.length>1000000||typeof secret!=='string'||secret.length<32)fail(400,'Invalid integration configuration.');
 if(!Number.isFinite(Number(timestamp))||Math.abs(clock-Number(timestamp)*1000)>300000)fail(401,'Webhook is expired.');
 const expected=createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest(),received=Buffer.from(String(signature||''),'hex');if(received.length!==expected.length||!timingSafeEqual(expected,received))fail(401,'Webhook signature is invalid.');
 try{return JSON.parse(raw)}catch{fail(400,'Invalid webhook payload.');}
}
export function sealCredential(value,key,locationId){if(!Buffer.isBuffer(key)||key.length!==32)fail(503,'Configure the integration encryption key.');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(locationId));const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
export function openCredential(value,key,locationId){const data=Buffer.from(value,'base64'),dec=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));dec.setAAD(Buffer.from(locationId));dec.setAuthTag(data.subarray(12,28));return Buffer.concat([dec.update(data.subarray(28)),dec.final()]).toString('utf8');}
export function ingestVerifiedOrder({db,locationId,provider,event,commit}){
 if(!/^[a-z0-9-]{2,40}$/.test(provider)||!event.id||!event.orderId||!Number.isInteger(event.revision)||event.revision<1||!['accepted','changed','cancelled'].includes(event.state))fail(400,'Invalid provider order event.');
 const key=[locationId,provider,event.id].join(':'),fingerprint=hash(event),prior=db.prepare('SELECT * FROM print_source_events WHERE source_key=?').get(key);if(prior){if(prior.payload_hash!==fingerprint)fail(409,'Provider event was replayed with different content.');return{orderId:prior.order_id,duplicate:true};}
 // commit must resolve provider SKUs/options and validate totals using the existing POS order service,
 // within this same transaction. It must never create another independent financial ledger.
 db.exec('BEGIN IMMEDIATE');try{const canonical=commit(event);if(!canonical?.id)fail(400,'Provider mapping did not produce a canonical order.');db.prepare('INSERT INTO print_source_events VALUES(?,?,?,?,?,?)').run(key,locationId,canonical.id,event.revision,fingerprint,now());db.exec('COMMIT');return{orderId:canonical.id,duplicate:false};}catch(e){db.exec('ROLLBACK');throw e;}
}
export function verifyPayment({event,expected,apply}){if(event.type!=='payment.confirmed'||event.orderId!==expected.orderId||event.reference!==expected.reference||event.amountMinor!==expected.amountMinor||event.currency!==expected.currency||Date.parse(expected.expiresAt)<Date.now())fail(409,'Payment does not match the current payment request.');return apply(event);}
