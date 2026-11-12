#!/usr/bin/env node
// Builds local operating-mode assets. No hosted website URL is packaged.
import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const kds=path.resolve(process.env.CUSTOMLI_KDS_PUBLIC||path.join(root,'../customli-v5/customli-v5-kds/public'));
const origin=process.env.CUSTOMLI_PLATFORM_ORIGIN||'https://customli.io';
if(!/^https:\/\/[^/]+$/.test(origin))throw Error('CUSTOMLI_PLATFORM_ORIGIN must be an HTTPS origin');
for(const file of ['index.html','styles.css','app.js'])if(!existsSync(path.join(kds,file)))throw Error('KDS asset missing: '+path.join(kds,file));
const out=path.join(root,'android-dist');
function vite(args,env={}){const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js',...args],{cwd:root,env:{...process.env,...env},stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
vite(['build','--config','vite.android.config.mjs'],{VITE_PLATFORM_ORIGIN:origin});
renameSync(path.join(out,'universal.html'),path.join(out,'index.html'));
vite(['build','--base=./','--outDir','android-dist/pos'],{VITE_API_BASE:origin+'/v5/api',VITE_AUTH_API_BASE:origin+'/v5-auth/api/auth',VITE_NATIVE_BUILD:'true',VITE_NATIVE_APP:'1'});
const frameBridge=String.raw`<script>
window.Capacitor=parent.Capacitor;
window.fetch=(input,options={})=>{
 const url=new URL(input,location.href);
 const headers=new Headers(options.headers);
 if(url.origin==='https://customli.io'&&(/^(\/v5\/api|\/v5-kds\/api)/).test(url.pathname)){
  headers.set('X-Customli-Location',parent.sessionStorage.getItem('customli-location-id')||'');
  headers.set('X-Customli-Installation',parent.sessionStorage.getItem('customli-installation-id')||'');
  headers.set('X-Customli-Mode',parent.sessionStorage.getItem('customli-mode')||'');
 }
 return parent.fetch(input,{...options,headers});
};</script>`;
const posIndex=path.join(out,'pos/index.html');writeFileSync(posIndex,readFileSync(posIndex,'utf8').replace('<head>','<head>'+frameBridge));
cpSync(kds,path.join(out,'kds'),{recursive:true});
cpSync(path.join(root,'public/brand'),path.join(out,'kds/brand'),{recursive:true});
const appPath=path.join(out,'kds/app.js');
let app=readFileSync(appPath,'utf8');
app=app.replace("const basePath=environmentKey==='test'?'/v5-kds-test':'/v5-kds';",'const basePath='+JSON.stringify(origin+'/v5-kds')+';');
app=app.replace("const brandPath=basePath+'/public/brand/';","const brandPath='./brand/';");
app=app.replace("const storagePrefix='customli-kds-'+environmentKey+'-'+scope;","const storagePrefix='customli-kds-'+environmentKey+'-'+scope+'-'+sessionStorage.getItem('customli-native-scope');");
app=app.replaceAll('localStorage.getItem(tokenKey)','sessionStorage.getItem(tokenKey)').replaceAll('localStorage.setItem(tokenKey,token)','sessionStorage.setItem(tokenKey,token)').replaceAll('localStorage.removeItem(tokenKey)','sessionStorage.removeItem(tokenKey)');
// Native devices are registered by the authenticated shell. Never show code pairing.
const loginStart=app.indexOf('function login(){'),loginEnd=app.indexOf('function componentRow(',loginStart);
if(loginStart<0||loginEnd<0)throw Error('KDS login contract changed; review native integration');
app=app.slice(0,loginStart)+"function login(){root.textContent='This display needs authorization. Reopen Customli or ask your manager.';}\n"+app.slice(loginEnd);
app=app.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register(basePath+'/public/sw.js').catch(()=>{});",'');
writeFileSync(appPath,app);
const kdsIndex=path.join(out,'kds/index.html');let html=readFileSync(kdsIndex,'utf8');html=html.replaceAll('/v5-kds/public/','./').replaceAll('/v5-kds/','./').replaceAll('\"public/','\"./').replaceAll("'public/","'./");html=html.replace('<head>','<head>'+frameBridge+'<style>#disconnect{display:none}</style>');writeFileSync(kdsIndex,html);
rmSync(path.join(out,'kds/sw.js'),{force:true});
const assets=path.join(root,'android-v5/app/src/main/assets');mkdirSync(assets,{recursive:true});
const target=path.join(assets,'public');rmSync(target,{recursive:true,force:true});cpSync(out,target,{recursive:true});
writeFileSync(path.join(assets,'capacitor.config.json'),JSON.stringify({appId:'io.customli.v5pos',appName:'Customli',webDir:'android-dist',android:{allowMixedContent:false},plugins:{CapacitorHttp:{enabled:true}},server:{hostname:'localhost',androidScheme:'https',cleartext:false}},null,2)+'\n');
writeFileSync(path.join(assets,'capacitor.plugins.json'),'[]\n');
console.log('Packaged local POS, KDS and CDS assets in '+target);
