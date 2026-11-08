// Explicit owner-authorized test-data maintenance. Never called by deployment.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
if(process.argv[2]!=='--owner-authorized-test-data'||!process.argv[3]||!process.argv[4])throw Error('Usage: node scripts/close-test-shift.mjs --owner-authorized-test-data /data/pos.sqlite /backup-directory');
const file=resolve(process.argv[3]),dest=resolve(process.argv[4]);mkdirSync(dest,{recursive:true,mode:0o700});
const db=new DatabaseSync(file);await backup(db,dest+'/pos-before-test-shift-close.sqlite');
const check=new DatabaseSync(dest+'/pos-before-test-shift-close.sqlite',{readOnly:true});if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity failed');check.close();
const shift=db.prepare('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1').get();if(!shift){console.log('No open test shift');db.close();process.exit(0)}
const counts=()=>({orders:db.prepare('SELECT COUNT(*) n,SUM(total) total FROM orders').get(),refunds:db.prepare('SELECT COUNT(*) n,SUM(amount) total FROM refunds').get()});
const before=counts();db.exec('BEGIN IMMEDIATE');
try{
 const sales=db.prepare("SELECT COALESCE(SUM(total-discount_total),0) amount FROM orders WHERE shift_id=? AND status IN ('paid','refunded') AND payment_method='Cash'").get(shift.id).amount;
 const refunds=db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM refunds WHERE payment_method='Cash' AND order_id IN (SELECT id FROM orders WHERE shift_id=?)").get(shift.id).amount;
 const movements=db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) amount FROM shift_cash_movements WHERE shift_id=?").get(shift.id).amount;
 const expected=shift.opening_cash+sales-refunds+movements,closedAt=new Date().toISOString();
 db.prepare('UPDATE shifts SET closed_at=?,closing_cash=0,expected_cash=?,variance=? WHERE id=? AND closed_at IS NULL').run(closedAt,expected,-expected,shift.id);
 db.exec('COMMIT');const record={authorization:'Owner confirmed V5 contains testing data only and authorized closing the open shift on 2026-11-08',shiftId:shift.id,closedAt,countedCashMinor:0,expectedCashMinor:expected,before,after:counts(),backup:dest+'/pos-before-test-shift-close.sqlite'};
 if(JSON.stringify(record.before)!==JSON.stringify(record.after))throw Error('Unexpected financial record change');writeFileSync(dest+'/test-shift-close.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}finally{db.close()}
