import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';

export async function startPlatformAuthFixture(){
 const accountId=randomUUID(),tenantId=randomUUID(),secret='qa-platform-auth-secret-0123456789',email='qa-owner@example.test',password='QaOnlyPass123',token=randomBytes(32).toString('base64url');
 let active=true;
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  let body={};try{if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;body=JSON.parse(raw||'{}');}}catch{return json(res,400,{message:'Invalid request'});}
  const valid=active&&(req.headers.authorization||'')==='Bearer '+token;
  if(req.method==='POST'&&req.url==='/api/auth/login'){
   if(body.email!==email||body.password!==password)return json(res,401,{message:'Email or password is incorrect'});
   active=true;return json(res,200,{token,expiresAt:new Date(Date.now()+3600000).toISOString(),user:{id:accountId,email,username:'QA Owner',displayName:'QA Owner',emailVerified:true,tenantId,role:'Owner'}});
  }
  if(req.method==='GET'&&req.url==='/api/auth/me')return valid?json(res,200,{id:accountId,email,username:'QA Owner',displayName:'QA Owner',emailVerified:true,memberships:[{tenantId,role:'Owner'}],providers:{google:false,apple:false}}):json(res,401,{message:'Session expired'});
  if(req.method==='POST'&&req.url==='/api/auth/logout'){active=false;return json(res,200,{ok:true});}
  if(req.method==='POST'&&req.url==='/api/auth/introspect'){
   if(req.headers['x-platform-auth-secret']!==secret)return json(res,403,{message:'Service authentication failed'});
   return active&&body.token===token?json(res,200,{id:accountId,email,displayName:'QA Owner',memberships:[{tenantId,role:'Owner'}]}):json(res,401,{message:'Invalid session'});
  }
  return json(res,404,{message:'Not found'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/api/auth';
 return {url,email,password,token,secret,accountId,tenantId,close:()=>new Promise(resolve=>server.close(resolve))};
}
