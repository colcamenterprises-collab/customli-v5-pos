import styles from './pos-availability.module.css';
import React,{useEffect,useState} from 'react';
const cache=new Map();
const inflight=new Map();
export function imageSource(path,token){
 if(!path)return Promise.resolve('');
 if(!/^\/v5(?:-test)?\/api\/images\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(path))return Promise.resolve(path);
 if(!window.Capacitor?.isNativePlatform?.())return Promise.resolve(path);
 if(cache.has(path))return Promise.resolve(cache.get(path));
 if(inflight.has(path))return inflight.get(path);
 const task=(async()=>{
  const url='https://customli.io'+path;
  const response=await window.Capacitor.Plugins.CapacitorHttp.request({url,method:'GET',headers:{Authorization:'Bearer '+token},responseType:'blob',connectTimeout:8000,readTimeout:12000});
  if(response.status!==200||typeof response.data!=='string')throw Error('Menu photo unavailable');
  const type=path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':'image/jpeg';
  const value='data:'+type+';base64,'+response.data;
  cache.set(path,value);return value;
 })().finally(()=>inflight.delete(path));inflight.set(path,task);return task;
}
export default function AuthenticatedImage({src,alt='',...props}){
 const [value,setValue]=useState('');const[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;setValue('');setFailed(false);imageSource(src,sessionStorage.getItem('customli-platform-session')||sessionStorage.getItem('v5_token')||'').then(v=>{if(active)setValue(v)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[src]);
 return value&&!failed?<img src={value} alt={alt} onError={()=>setFailed(true)} {...props}/>:<span role="img" aria-label={failed?'Menu photo unavailable':alt||'Menu photo loading'} className={styles.loading}>{failed?'No photo':''}</span>;
}
