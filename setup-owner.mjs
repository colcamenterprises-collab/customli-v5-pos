import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import path from 'node:path';
const dir=process.env.V5_DATA_DIR||'/var/lib/customli-v5-test';
const db=new DatabaseSync(path.join(dir,'pos.sqlite'));
const existing=db.prepare("SELECT username FROM users WHERE role='Owner' AND active=1 LIMIT 1").get();
if(existing){console.error('An active Owner account already exists; no account was changed.');process.exit(1);}
let username=(process.argv[2]||'owner').trim();
if(!/^[a-zA-Z0-9_-]{3,32}$/.test(username)){console.error('Choose a 3–32 character username.');process.exit(1);}
if(db.prepare('SELECT id FROM users WHERE username=?').get(username)){console.error('That username is already in use; rerun with a different username.');process.exit(1);}
const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
db.prepare('INSERT INTO users(id,username,role,salt,password_hash,active) VALUES(?,?,?,?,?,1)').run(randomUUID(),username,'Owner',salt,scryptSync(password,salt,64).toString('hex'));
console.log(JSON.stringify({username,password,role:'Owner',note:'Save this one-time credential securely. Change it after signing in.'}));
