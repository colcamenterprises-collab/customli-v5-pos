import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import path from 'node:path';
const required=(x,n)=>{const v=String(x??'').trim();if(!v||v.length>n)throw Object.assign(new Error('Invalid '+n+'-character field'),{status:400});return v};
export class TenantRegistry{
 constructor(root){this.root=root;mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);this.db=new DatabaseSync(path.join(root,'registry.sqlite'));this.db.exec("PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL);CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);");}
 register({restaurantName,email,password,timezone='Asia/Bangkok',currency='THB'}){
  const name=required(restaurantName,120),mail=required(email,254).toLowerCase(),pass=String(password??'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)||pass.length<12||pass.length>128)throw Object.assign(new Error('Valid email and password of 12–128 characters required'),{status:400});
  if(this.db.prepare('SELECT 1 FROM accounts WHERE email=?').get(mail))throw Object.assign(new Error('Email already registered'),{status:409});
  if(currency!=='THB'||timezone!=='Asia/Bangkok')throw Object.assign(new Error('Locale not supported yet'),{status:400});
  const id=randomUUID(),slug='r-'+id,dir=path.join(this.root,'restaurants',id),salt=randomBytes(16).toString('hex'),hash=scryptSync(pass,salt,64).toString('hex'),now=new Date().toISOString();
  mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const tenantDb=new DatabaseSync(path.join(dir,'pos.sqlite'));
  try{
   tenantDb.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER DEFAULT 1);CREATE TABLE restaurant_identity(id TEXT PRIMARY KEY,name TEXT NOT NULL,timezone TEXT NOT NULL,currency TEXT NOT NULL);");
   tenantDb.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(randomUUID(),mail,'Owner',salt,hash);
   tenantDb.prepare('INSERT INTO restaurant_identity VALUES(?,?,?,?)').run(id,name,timezone,currency);
   this.db.exec('BEGIN IMMEDIATE');
   try{this.db.prepare('INSERT INTO tenants VALUES(?,?,?,?,?)').run(id,name,slug,now,'provisioning');this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(randomUUID(),id,mail,salt,hash,now);this.db.exec('COMMIT')}
   catch(e){this.db.exec('ROLLBACK');throw e}
  }finally{tenantDb.close()}
  return {tenantId:id,slug,restaurantName:name,status:'provisioning'};
 }
 close(){this.db.close()}
}
