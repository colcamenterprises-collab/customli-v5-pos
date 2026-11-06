import { createHash } from 'node:crypto';

const cache=new Map();
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function platformIdentity(token){
 const url=process.env.PLATFORM_AUTH_INTROSPECT_URL,secret=process.env.PLATFORM_AUTH_SERVICE_SECRET;
 if(!url||!secret||!token)return null;
 const key=hash(token),cached=cache.get(key);
 if(cached&&cached.expires>Date.now())return cached.identity;
 try{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Platform-Auth-Secret':secret},body:JSON.stringify({token}),signal:AbortSignal.timeout(2500),cache:'no-store'});
  if(!response.ok)return null;
  const identity=await response.json();
  if(!identity?.id||!Array.isArray(identity.memberships))return null;
  cache.set(key,{identity,expires:Date.now()+3000});
  if(cache.size>10000){for(const [k,v] of cache)if(v.expires<=Date.now())cache.delete(k);}
  return identity;
 }catch{return null;}
}
