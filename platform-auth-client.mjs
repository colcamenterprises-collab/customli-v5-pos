export async function platformIdentity(token){
 const url=process.env.PLATFORM_AUTH_INTROSPECT_URL,secret=process.env.PLATFORM_AUTH_SERVICE_SECRET;
 if(!url||!secret||!token)return null;
 try{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Platform-Auth-Secret':secret},body:JSON.stringify({token}),signal:AbortSignal.timeout(2500),cache:'no-store'});
  if(!response.ok)return null;
  const identity=await response.json();
  if(!identity?.id||!Array.isArray(identity.memberships))return null;
  return identity;
 }catch{return null;}
}
