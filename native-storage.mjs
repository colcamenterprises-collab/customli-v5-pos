// No credentials are stored here. Android backup is disabled for local business data.
const scope=()=>sessionStorage.getItem('customli-device-id')+'@'+sessionStorage.getItem('customli-location-id');
let opening;
function database(){return opening||=new Promise((resolve,reject)=>{const r=indexedDB.open('customli-native-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('cache');r.result.createObjectStore('commands',{keyPath:'id'});r.result.createObjectStore('prints',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function op(store,mode,callback){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;try{const req=callback(tx.objectStore(store));req.onsuccess=()=>result=req.result;req.onerror=()=>reject(req.error)}catch(e){reject(e)}tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Local storage was interrupted'))})}
export const nativeScope=scope;
export const cachePut=(path,value)=>op('cache','readwrite',s=>s.put({value,savedAt:Date.now()},scope()+path));
export const cacheGet=path=>op('cache','readonly',s=>s.get(scope()+path));
export async function prepareCommand(body){if(!body?.idempotencyKey)throw Error('Order identity is required');const rows=await pendingCommands();const same=rows.find(x=>x.id===scope()+':'+body.idempotencyKey);if(same&&JSON.stringify(same.body)!==JSON.stringify(body))throw Error('A saved payment is waiting to synchronize. Do not change or enter it again.');const existing=rows.find(x=>x.id!==scope()+':'+body.idempotencyKey);if(existing)throw Error('A saved payment is waiting to synchronize. Reconnect before starting another payment.');return op('commands','readwrite',s=>s.put({id:scope()+':'+body.idempotencyKey,scope:scope(),body,createdAt:Date.now()}))}
export const pendingCommands=async()=>(await op('commands','readonly',s=>s.getAll())).filter(x=>x.scope===scope()).sort((a,b)=>a.createdAt-b.createdAt);
export const acknowledgeCommand=key=>op('commands','readwrite',s=>s.delete(scope()+':'+key));
export const printJobs=async()=>(await op('prints','readonly',s=>s.getAll())).filter(x=>x.scope===scope());
export const savePrintJob=job=>op('prints','readwrite',s=>s.put({...job,scope:scope()}));
