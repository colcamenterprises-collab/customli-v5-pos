import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const forbidden=()=>Object.assign(new Error('Invalid credentials'),{status:401});
export function installTenantSessions(registry){
 registry.db.exec("CREATE TABLE IF NOT EXISTS customer_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS onboarding_drafts(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),step TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL);");
}
export function loginCustomer(registry,{email,password}){
 const account=registry.db.prepare('SELECT * FROM accounts WHERE email=?').get(String(email||'').trim().toLowerCase());
 if(!account)throw forbidden();
 const hash=Buffer.from(scryptSync(String(password||''),account.salt,64).toString('hex'),'hex');
 const expected=Buffer.from(account.password_hash,'hex');
 if(hash.length!==expected.length||!timingSafeEqual(hash,expected))throw forbidden();
 const token=randomBytes(32).toString('hex');
 registry.db.prepare('INSERT INTO customer_sessions VALUES(?,?,?)').run(sha(token),account.id,new Date(Date.now()+12*3600*1000).toISOString());
 return {token,tenantId:account.tenant_id};
}
export function authenticateCustomer(registry,token){
 if(!/^[a-f0-9]{64}$/.test(String(token||'')))throw forbidden();
 const row=registry.db.prepare("SELECT a.id AS accountId,a.tenant_id AS tenantId,t.status FROM customer_sessions s JOIN accounts a ON a.id=s.account_id JOIN tenants t ON t.id=a.tenant_id WHERE s.token_hash=? AND s.expires_at>?").get(sha(token),new Date().toISOString());
 if(!row)throw forbidden();return row;
}
export function saveOnboardingDraft(registry,session,{step,payload}){
 const owner=authenticateCustomer(registry,session);
 if(!['business','menu','ingredients','recipes','review'].includes(step)||!payload||typeof payload!=='object'||Array.isArray(payload))throw Object.assign(new Error('Invalid setup draft'),{status:400});
 const serialized=JSON.stringify(payload);if(serialized.length>100000)throw Object.assign(new Error('Setup draft too large'),{status:413});
 registry.db.prepare("INSERT INTO onboarding_drafts VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET step=excluded.step,payload=excluded.payload,updated_at=excluded.updated_at").run(owner.tenantId,step,serialized,new Date().toISOString());
 return {tenantId:owner.tenantId,step,saved:true};
}
export function loadOnboardingDraft(registry,session){
 const owner=authenticateCustomer(registry,session);
 const draft=registry.db.prepare('SELECT step,payload,updated_at FROM onboarding_drafts WHERE tenant_id=?').get(owner.tenantId);
 return draft?{step:draft.step,payload:JSON.parse(draft.payload),updatedAt:draft.updated_at}:{step:'business',payload:{}};
}
