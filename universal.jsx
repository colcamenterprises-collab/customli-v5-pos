import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Select from './select.jsx';
import './design-system.css';
import styles from './universal.module.css';

const ORIGIN=import.meta.env.VITE_PLATFORM_ORIGIN||'https://customli.io';
const AUTH=ORIGIN+'/v5-auth/api/auth';
const VERSION='1.1.0';
const deviceStore=()=>window.Capacitor?.Plugins?.DeviceIdentity;
const currency=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'THB'}).format(Number(n||0)/100);
async function request(url,token='',body){
 const headers={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
 const method=body===undefined?'GET':'POST';
 let status,data;
 const native=window.Capacitor?.Plugins?.CapacitorHttp;
 if(native){const response=await native.request({url,method,headers,...(body===undefined?{}:{data:body}),connectTimeout:8000,readTimeout:12000});status=response.status;data=response.data;}
 else{const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});status=response.status;data=await response.json();}
 if(status<200||status>=300)throw Object.assign(new Error(data?.message||'Customli could not connect. Please try again.'),{status});
 return data;
}
function CustomerDisplay({token,device}){
 const [display,setDisplay]=useState(null),[offline,setOffline]=useState(false);
 useEffect(()=>{let active=true;const update=async()=>{try{const next=await request(ORIGIN+'/v5/api/display?posDeviceId='+encodeURIComponent(device.posDeviceId||''),token);if(active){setDisplay(next);setOffline(next.stale===true);}}catch{if(active)setOffline(true);}};update();const timer=setInterval(update,1000);return()=>{active=false;clearInterval(timer);};},[token,device.posDeviceId]);
 const waiting=!display||display.state==='waiting';
 const safeLogo=display?.branding?.logo&&/^https:\/\/customli\.io\//.test(display.branding.logo)?display.branding.logo:null;
 return <main className={styles.customer}>
  <header>{safeLogo&&<img src={safeLogo} alt=""/>}<h1>{display?.branding?.name||'Welcome'}</h1></header>
  {offline?<div className={styles.waiting}><h2>Reconnecting</h2><p>Your cashier can help with your order.</p></div>:waiting?<div className={styles.waiting}><h2>Ready when you are</h2><p>Your order will appear here.</p></div>:<>
   <div className={styles.items}>{(display.items||[]).map((item,index)=><article key={index}><span>{item.quantity} × {item.name}</span><strong>{currency(item.unitPrice*item.quantity)}</strong></article>)}</div>
   <footer><div><span>Subtotal</span><strong>{currency(display.subtotal)}</strong></div>{Number(display.discount)>0&&<div><span>Discount</span><strong>−{currency(display.discount)}</strong></div>}<div className={styles.total}><span>Total</span><strong>{currency(display.total)}</strong></div><p>{display.state==='recorded'?'Thank you. Your order has been recorded.':'Please complete payment with your cashier.'}</p></footer>
  </>}
 </main>;
}
const clearKitchenCache=()=>{for(const key of Object.keys(localStorage))if(/^customli-kds-(?:production|test)-.*(?:board-cache|pending-actions|event-cursor)$/.test(key))localStorage.removeItem(key);};
function App(){
 const [screen,setScreen]=useState('loading'),[saved,setSaved]=useState(null),[locations,setLocations]=useState([]),[locationId,setLocationId]=useState(''),[mode,setMode]=useState('POS'),[devices,setDevices]=useState([]),[posDeviceId,setPosDeviceId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reconnecting,setReconnecting]=useState(false),[nearby,setNearby]=useState([]);
 const accountToken=useRef(''),installationId=useRef('');
 const persist=async next=>{await deviceStore().save({credential:JSON.stringify(next)});setSaved(next);};
 const open=async next=>{if(saved?.device&&['id','tenantId','locationId','mode','station'].some(key=>saved.device[key]!==next.device[key]))clearKitchenCache();await persist(next);sessionStorage.setItem('customli-platform-session',next.token);sessionStorage.setItem('customli-device-id',next.device.id);sessionStorage.setItem('customli-location-id',next.device.locationId);sessionStorage.setItem('customli-kds-production-device-token',next.token);sessionStorage.setItem('customli-native-scope',[next.device.tenantId,next.device.locationId,next.device.id].join(':'));setScreen('mode');};
 const revoke=async message=>{const discovery=window.Capacitor?.Plugins?.DeviceDiscovery;if(discovery)await discovery.stop().catch(()=>{});clearKitchenCache();await deviceStore()?.clear();sessionStorage.clear();setSaved(null);setScreen('login');setError(message);};
 useEffect(()=>{let active=true;(async()=>{try{if(!window.Capacitor?.isNativePlatform?.()||!deviceStore())throw Error('Install the Customli Android application to set up this device.');const state=await deviceStore().read();installationId.current=state.installationId;if(state.credential){const next=JSON.parse(state.credential);try{const device=await request(AUTH+'/devices/self',next.token);if(active)await open({...next,device});}catch(e){if(e.status===401||e.status===403){if(active)await revoke('This device needs authorization. Ask your manager to sign in.');}else if(active){if(Date.parse(next.device?.offlineUntil||'')>Date.now()){await open(next);setReconnecting(true);}else{setSaved(next);setReconnecting(true);setError('Connect to the internet to verify this device.');setScreen('connection');}}}}else if(active)setScreen('login');}catch(e){if(active){setError(e.message);setScreen('unavailable');}}})();return()=>{active=false;};},[]);
 useEffect(()=>{const expired=()=>revoke('This device needs authorization. Ask your manager to sign in.');window.addEventListener('customli-device-expired',expired);return()=>window.removeEventListener('customli-device-expired',expired)},[]);
 useEffect(()=>{if(screen!=='mode'||!saved)return;let active=true;const beat=async()=>{try{const result=await request(AUTH+'/devices/heartbeat',saved.token,{version:VERSION});if(!active)return;const device=result.device||result;setReconnecting(false);if(JSON.stringify(device)!==JSON.stringify(saved.device))await open({...saved,device});}catch(e){if(!active)return;if(e.status===401||e.status===403)await revoke('This device has been disconnected. Ask your manager to authorize it again.');else{setReconnecting(true);if(!(Date.parse(saved.device?.offlineUntil||'')>Date.now())){setScreen('connection');setError('Connect to verify this device before continuing.');}}}};const timer=setInterval(beat,15000);return()=>{active=false;clearInterval(timer);};},[screen,saved]);
 useEffect(()=>{
  if(screen!=='mode'||!saved)return;
  const plugin=window.Capacitor?.Plugins?.DeviceDiscovery;if(!plugin)return;
  let active=true;
  (async()=>{try{await plugin.start({deviceId:saved.device.id});const [result,allowed]=await Promise.all([plugin.discover(),request(AUTH+'/devices/peers',saved.token)]);if(!active)return;const ids=new Set((result.peers||[]).map(x=>x.id));const matches=allowed.filter(x=>ids.has(x.id)&&x.locationId===saved.device.locationId&&x.tenantId===saved.device.tenantId);setNearby(matches);sessionStorage.setItem('customli-nearby-devices',JSON.stringify(matches));}catch{if(active)setNearby([]);}})();
  return()=>{active=false;plugin.stop().catch(()=>{});};
 },[screen,saved?.device?.id,saved?.device?.locationId,saved?.device?.mode,saved?.device?.station,saved?.token]);
 const availablePos=devices.filter(x=>x.mode==='POS'&&x.locationId===locationId&&!x.revokedAt);
 useEffect(()=>{setPosDeviceId(availablePos.length===1?availablePos[0].id:'');},[devices,locationId]);
 const signIn=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');const form=new FormData(e.currentTarget);try{const login=await request(AUTH+'/login','',{email:form.get('email'),password:form.get('password')});accountToken.current=login.token;const choices=await request(AUTH+'/locations',login.token);setLocations(choices);setLocationId(choices.length===1?choices[0].id:'');const registered=await request(AUTH+'/devices',login.token);setDevices(registered);setScreen('setup');}catch(e){setError(e.message);}finally{setBusy(false);}};
 const register=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');const form=new FormData(e.currentTarget);try{const next=await request(AUTH+'/devices/register',accountToken.current,{installationId:installationId.current,locationId,mode,name:String(form.get('name')||''),station:mode==='KDS'?String(form.get('station')||''):undefined,posDeviceId:mode==='CDS'?posDeviceId:undefined,version:VERSION});await open(next);await request(AUTH+'/logout',accountToken.current,{}).catch(()=>{});accountToken.current='';}catch(e){setError(e.message);}finally{setBusy(false);}};
 const retry=async()=>{setBusy(true);setError('');try{const device=await request(AUTH+'/devices/self',saved.token);await open({...saved,device});setReconnecting(false);}catch(e){if(e.status===401||e.status===403)await revoke('Ask your manager to authorize this device again.');else setError('Customli is still reconnecting. Check this device’s internet connection.');}finally{setBusy(false);}};
 if(screen==='mode'&&saved){const device=saved.device;return <div className={styles.operating}>{nearby.length>0&&device.mode!=='CDS'&&<div className={styles.discovery}>{nearby.length} nearby registered {nearby.length===1?'device':'devices'}</div>}{reconnecting&&device.mode!=='CDS'&&<div className={styles.connection}>Reconnecting to Customli</div>}{device.mode==='CDS'?<CustomerDisplay token={saved.token} device={device}/>:<iframe key={device.mode+':'+(device.station||'')} title={device.mode==='POS'?'Point of sale':'Kitchen display'} src={device.mode==='POS'?'./pos/index.html':'./kds/index.html'} className={styles.frame}/>}</div>;}
 return <main className={styles.setup}><section className={styles.card}><img className={styles.logo} src="./brand/customli-dark.png" alt="Customli"/>
 {screen==='loading'?<p>Opening Customli…</p>:screen==='login'?<form onSubmit={signIn}><h1>Sign in</h1><label>Email<input type="email" name="email" autoComplete="username" required/></label><label>Password<input type="password" name="password" autoComplete="current-password" required/></label><button disabled={busy}>{busy?'Signing in…':'Continue'}</button></form>:screen==='setup'?<form onSubmit={register}><h1>Set up this device</h1><label>Restaurant<Select aria-label="Restaurant" value={locationId} onChange={e=>setLocationId(e.target.value)} required><option value="">Choose restaurant</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></label><label>Device name<input name="name" maxLength="80" placeholder="Front counter" required/></label><label>Use this device for<Select aria-label="Use this device for" value={mode} onChange={e=>setMode(e.target.value)}><option value="POS">Point of sale</option><option value="KDS">Kitchen display</option><option value="CDS">Customer display</option></Select></label>{mode==='KDS'&&<label>Kitchen station<input name="station" maxLength="80" placeholder="Expo" required/></label>}{mode==='CDS'&&<label>POS device<Select aria-label="POS device" value={posDeviceId} onChange={e=>setPosDeviceId(e.target.value)} required><option value="">Choose POS</option>{availablePos.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>}<button disabled={busy||!locationId}>{busy?'Saving…':'Save device'}</button></form>:screen==='connection'?<><h1>Connect to continue</h1><button disabled={busy} onClick={retry}>{busy?'Reconnecting…':'Try again'}</button></>:<h1>Android setup required</h1>}
 {error&&<p className={styles.error} role="alert">{error}</p>}<small>Customli {VERSION}</small></section></main>;
}
createRoot(document.querySelector('#app')).render(<App/>);
